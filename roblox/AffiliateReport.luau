--!strict
--[[
	AffiliateReport — lapor ke backend afiliasi admin (affiliate.kelasmalam.app).

	Tiga kejadian yang dilaporin, semuanya FIRE-AND-FORGET (nggak pernah nge-yield
	pemanggil, nggak punya nilai balik):
	  * Join     — dari AffiliateService, bawa LaunchData share link admin
	  * Robux    — dari ReceiptService, SESUDAH handler produk bilang tersimpan
	  * Donation — dari DonationBoardService, SESUDAH donasi kecatat di papan

	=== KENAPA NGGAK BOLEH NGARUHIN KEPUTUSAN GAME ===
	Komisi admin itu urusan backend. Kalau backend-nya mati, pemain tetap dapet
	barangnya, donasi tetap kecatat di papan. Yang hilang cuma laporan, dan
	backend-nya idempoten by id (PurchaseId / id transaksi BagiBagi), jadi
	ngirim ulang kapan pun aman — receipt Robux yang gagal kelapor disimpen ke
	antrean DataStore dan dikirim ulang berkala.

	=== KREDENSIAL ===
	Header `x-map-key` dibaca dari Roblox Secret "AF" lewat ApiAuth.affiliateKey().
	Nilainya = ingest key map "Jaksel Space" di dashboard afiliasi (Config -> Maps).
	Secret nggak kebaca = fitur mati, warn sekali, game jalan normal.

	=== STUDIO ===
	ApiAuth.affiliateKey() di Studio baca secret "AF_STUDIO" (map tes), bukan
	"AF" (produksi). Nggak ada AF_STUDIO = laporan mati, warn sekali. Jadi tes
	dari Studio nggak pernah nyentuh key produksi. Donasi :Simulate() CUMA
	diterusin di Studio — di server live dia dilewatin.
]]

local DataStoreService = game:GetService("DataStoreService")
local HttpService = game:GetService("HttpService")
local MarketplaceService = game:GetService("MarketplaceService")
local RunService = game:GetService("RunService")
local ServerScriptService = game:GetService("ServerScriptService")

local LOG_PREFIX = "[AffiliateReport]"

local BASE_URL = "https://affiliate.kelasmalam.app"
local MAX_ATTEMPTS = 3
local PENDING_STORE = "AffiliatePending_v1"
local FLUSH_INTERVAL = 300

local AffiliateReport = {}

local apiAuth: any = nil
local function auth(): any
	if apiAuth == nil then
		apiAuth = require(ServerScriptService.Server.ApiAuth)
	end
	return apiAuth
end

local function enabled(): boolean
	-- nil = secret nggak kebaca; ApiAuth udah ngewarn sekali dengan nama secret-nya.
	return auth().affiliateKey() ~= nil
end

--[[
	POST satu payload. YIELD. Balikin true kalau backend jawab 2xx.
	4xx = salah payload/key, nggak diulang (nggak bakal berubah). 5xx/HttpError
	diulang dengan backoff.
]]
local function post(path: string, body: { [string]: any }): (boolean, any)
	local key = auth().affiliateKey()
	if key == nil then
		return false, nil
	end

	local payload = HttpService:JSONEncode(body)
	local lastErr = ""

	for attempt = 1, MAX_ATTEMPTS do
		local ok, res = pcall(function()
			return HttpService:RequestAsync({
				Url = BASE_URL .. path,
				Method = "POST",
				Headers = {
					["Content-Type"] = "application/json",
					["x-map-key"] = key,
				},
				Body = payload,
			})
		end)

		if ok and res.Success then
			-- print, bukan warn: ini jalur normal. Sengaja kelihatan di Output biar
			-- tes di Studio bisa dipastiin beneran nyampe, bukan cuma "nggak error".
			print(`{LOG_PREFIX} terkirim {path} -> HTTP {res.StatusCode}: {tostring(res.Body):sub(1, 160)}`)
			local decoded = nil
			pcall(function()
				decoded = HttpService:JSONDecode(res.Body)
			end)
			return true, decoded
		end

		if ok and res.StatusCode >= 400 and res.StatusCode < 500 then
			warn(`{LOG_PREFIX} {path} ditolak HTTP {res.StatusCode}: {tostring(res.Body):sub(1, 200)}`)
			return false, nil
		end

		lastErr = if ok then `HTTP {res.StatusCode}` else tostring(res)
		if attempt < MAX_ATTEMPTS then
			task.wait(0.5 * 2 ^ (attempt - 1))
		end
	end

	warn(`{LOG_PREFIX} {path} gagal setelah {MAX_ATTEMPTS} percobaan: {lastErr}`)
	return false, nil
end

--[[
	Join pemain. launchData nil kalau bukan lewat share link — tetap dilaporin biar spender
	organik kecatat dan bisa dicocokin sama donasi BagiBagi. referredBy = GetJoinData().ReferredByPlayerId
	(undangan Roblox); backend yang memutuskan apakah pengundangnya admin.

	onResult(body) dipanggil di thread sendiri SESUDAH backend menjawab, dengan body JSON:
	  { outcome, via, referrerAdminId, admin = { referralCode, launchData } | nil, invite = { inviterRobloxUserId, outcome, alreadyOwn, message } | nil }
	Dipakai AffiliateService buat nyalain tombol "Undang teman" (kalau pemainnya admin) dan
	ngasih notif ke pengundang. Kalau HTTP gagal, onResult nggak dipanggil sama sekali.
]]
function AffiliateReport.Join(player: Player, launchData: string?, referredBy: number?, onResult: ((body: any) -> ())?, joinDataRaw: { [string]: any }?)
	if not enabled() then
		return
	end
	task.spawn(function()
		local ok, body = post("/ingest/join", {
			robloxUserId = player.UserId,
			username = player.Name,
			displayName = player.DisplayName,
			launchData = launchData,
			referredByRobloxUserId = referredBy,
			joinData = joinDataRaw,
			waitedSeconds = joinDataRaw and joinDataRaw.waited or nil,
			joinedAt = os.time(),
		})
		if ok and typeof(body) == "table" and onResult then
			onResult(body)
		end
	end)
end

--[[
	Harga produk dari katalog, di-cache per productId. Dipakai CUMA kalau
	receipt bilang CurrencySpent = 0 — itu perilaku Studio yang udah dikenal
	(pembelian tes selalu 0, devforum #749742). Di server live CurrencySpent
	udah bener dan jalur ini nggak kesentuh. YIELD; pemanggilnya udah di thread
	sendiri.
]]
local priceCache: { [number]: number } = {}
local function productPrice(productId: any): number?
	if typeof(productId) ~= "number" then
		return nil
	end
	local cached = priceCache[productId]
	if cached then
		return cached
	end
	local ok, info = pcall(MarketplaceService.GetProductInfo, MarketplaceService, productId, Enum.InfoType.Product)
	if ok and typeof(info) == "table" and typeof(info.PriceInRobux) == "number" then
		priceCache[productId] = info.PriceInRobux
		return info.PriceInRobux
	end
	return nil
end

local function robuxBody(info: any): { [string]: any }
	return {
		purchaseId = tostring(info.PurchaseId),
		robloxUserId = info.PlayerId,
		productId = info.ProductId,
		currencySpent = info.CurrencySpent,
		currencyType = tostring(info.CurrencyType),
		placeId = info.PlaceIdWherePurchased,
		purchasedAt = os.time(),
	}
end

local pendingStore: DataStore? = nil
local function pending(): DataStore?
	if pendingStore == nil then
		local ok, store = pcall(DataStoreService.GetDataStore, DataStoreService, PENDING_STORE)
		if ok then
			pendingStore = store
		end
	end
	return pendingStore
end

--[[
	Receipt developer product yang udah GRANTED. Dipanggil ReceiptService di
	jalur sukses aja. Kalau backend nggak bisa dihubungi, receipt-nya diparkir di
	DataStore dan dikirim ulang oleh FlushPending.
]]
function AffiliateReport.Robux(info: any)
	if not enabled() then
		return
	end
	task.spawn(function()
		local body = robuxBody(info)
		if body.currencySpent == 0 then
			local price = productPrice(info.ProductId)
			if price and price > 0 then
				body.currencySpent = price
				body.priceSource = "product_info"
			end
		end
		if post("/ingest/robux", body) then
			return
		end
		local store = pending()
		if store then
			pcall(store.SetAsync, store, body.purchaseId, body)
		end
	end)
end

--[[
	Donasi BagiBagi yang udah lolos dedupe. `userId` nil = donatur nggak
	ketemu; backend masukin ke antrean "Unmatched" buat dicocokin owner.
	Donasi hasil :Simulate() dilewatin — itu tes, bukan duit.
]]
function AffiliateReport.Donation(event: any, userId: number?, username: string?)
	if not enabled() then
		return
	end
	if typeof(event) ~= "table" then
		return
	end
	if event.src == "simulate" and not RunService:IsStudio() then
		return
	end
	task.spawn(post, "/ingest/bagibagi", {
		id = tostring(event.id),
		donorName = event.n or "",
		amountIdr = event.a or 0,
		message = event.m or "",
		username = if username ~= nil and username ~= "" then username else nil,
		robloxUserId = userId,
		occurredAt = event.t or os.time(),
	})
end

--[[ Kirim ulang receipt yang keparkir. Dipanggil berkala dari AffiliateService. ]]
function AffiliateReport.FlushPending()
	if not enabled() then
		return
	end
	local store = pending()
	if store == nil then
		return
	end

	local ok, pages = pcall(store.ListKeysAsync, store)
	if not ok then
		return
	end

	while true do
		for _, key in pages:GetCurrentPage() do
			local okGet, body = pcall(store.GetAsync, store, key.KeyName)
			if okGet and typeof(body) == "table" and post("/ingest/robux", body) then
				pcall(store.RemoveAsync, store, key.KeyName)
			end
		end
		if pages.IsFinished then
			break
		end
		local okNext = pcall(pages.AdvanceToNextPageAsync, pages)
		if not okNext then
			break
		end
	end
end

AffiliateReport.FLUSH_INTERVAL = FLUSH_INTERVAL

return AffiliateReport
