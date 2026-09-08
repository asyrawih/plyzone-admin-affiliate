--!strict
--[[
	AffiliateService — atribusi admin afiliasi.

	Tiga jalur pemain "terikat" ke admin (first-touch, semua diputusin backend):
	  1. Share link: https://www.roblox.com/games/start?placeId=<PLACE>&launchData=ref_<KODE>
	     → GetJoinData().LaunchData
	  2. Undangan Roblox dari tombol "Undang teman" milik game (PromptGameInvite + LaunchData ref_<KODE>)
	     → juga lewat LaunchData, sama persis dengan link
	  3. Undangan Roblox dari menu sistem (Invite di menu Escape) → GetJoinData().ReferredByPlayerId
	     = UserId pengundang; backend mencocokkan ke admin yang punya akun Roblox itu

	Service ini cuma NERUSIN nilainya ke backend lewat AffiliateReport.Join dan MENERUSKAN
	jawabannya ke client:
	  * Client.InviteReady(launchData)  → pemain ini admin aktif: tampilkan tombol "Undang teman"
	  * Client.Notify(message)          → ke PENGUNDANG (kalau ada di server ini): hasil undangannya,
	                                      termasuk "sudah terikat ke admin lain"

	Join TANPA LaunchData juga dilaporin: backend butuh tahu spender-nya ada, biar donasi
	BagiBagi atas nama dia bisa dicocokin.

	Nggak nge-yield PlayerAdded: GetJoinData bisa error di detik-detik awal (lihat RejoinService),
	makanya pcall dan semuanya di thread sendiri.

	Sekalian jadi rumah timer FlushPending buat receipt Robux yang gagal kelapor.
]]

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerScriptService = game:GetService("ServerScriptService")

local Knit = require(ReplicatedStorage.Packages.Knit)
local Trove = require(ReplicatedStorage.Packages.Trove)
local AffiliateReport = require(ServerScriptService.Server.AffiliateReport)

type Trove = typeof(Trove.new())

local AffiliateService = Knit.CreateService({
	Name = "AffiliateService",
	_trove = (nil :: any) :: Trove,
	--[[ launchData per admin yang online: dipakai ulang kalau client minta lagi (mis. sesudah respawn UI). ]]
	_launchData = {} :: { [number]: string },
	Client = {
		InviteReady = Knit.CreateSignal(),
		Notify = Knit.CreateSignal(),
		RequestInviteReady = Knit.CreateSignal(),
	},
})

function AffiliateService:_OnJoinResult(player: Player, body: any)
	-- Pemain ini admin aktif → tombol "Undang teman" dengan LaunchData kodenya.
	if typeof(body.admin) == "table" and typeof(body.admin.launchData) == "string" then
		self._launchData[player.UserId] = body.admin.launchData
		self.Client.InviteReady:Fire(player, body.admin.launchData)
	end

	-- Masuk lewat undangan Roblox → kabari pengundangnya kalau dia lagi di server ini.
	local invite = body.invite
	if typeof(invite) == "table" and typeof(invite.message) == "string" and typeof(invite.inviterRobloxUserId) == "number" then
		local inviter = Players:GetPlayerByUserId(invite.inviterRobloxUserId)
		if inviter then
			self.Client.Notify:Fire(inviter, invite.message, invite.outcome)
		end
	end
end

--[[ Berapa lama nunggu LaunchData/ReferredByPlayerId muncul. Dokumentasi Roblox (invite prompts):
     "Launch data can take a few seconds to appear after the friend joins from the invite."
     Kalau dilaporin di detik pertama, undangan kebaca sebagai join biasa. ]]
local JOIN_DATA_WAIT = 15
local JOIN_DATA_POLL = 0.5

--[[ Salinan GetJoinData yang aman di-JSON (tanpa TeleportData besar): buat diagnostik di backend. ]]
local function readJoinData(player: Player): (string?, number?, { [string]: any })
	local launchData: string? = nil
	local referredBy: number? = nil
	local raw: { [string]: any } = {}
	local ok, joinData = pcall(function()
		return player:GetJoinData()
	end)
	if ok and typeof(joinData) == "table" then
		for _, k in { "SourceGameId", "SourcePlaceId", "ReferredByPlayerId", "LaunchData", "Members" } do
			local v = (joinData :: any)[k]
			if typeof(v) == "table" then
				raw[k] = #v
			elseif v ~= nil then
				raw[k] = v
			end
		end
		local td = (joinData :: any).TeleportData
		raw.HasTeleportData = td ~= nil
		-- Kunci-kunci TeleportData saja (bukan isinya): membedakan rejoin tiket kita vs teleport dari server lain.
		if typeof(td) == "table" then
			local keys = {}
			for k in td do table.insert(keys, tostring(k)) end
			raw.TeleportDataKeys = table.concat(keys, ",")
		elseif td ~= nil then
			raw.TeleportDataType = typeof(td)
		end
		if typeof(joinData.LaunchData) == "string" and joinData.LaunchData ~= "" then
			launchData = joinData.LaunchData
		end
		if typeof(joinData.ReferredByPlayerId) == "number" and joinData.ReferredByPlayerId > 0 then
			referredBy = joinData.ReferredByPlayerId
		end
	else
		raw.error = tostring(joinData)
	end
	return launchData, referredBy, raw
end

function AffiliateService:_OnPlayerAdded(player: Player)
	task.spawn(function()
		local t0 = os.clock()
		local launchData, referredBy, raw = readJoinData(player)
		local deadline = t0 + JOIN_DATA_WAIT
		while launchData == nil and referredBy == nil and os.clock() < deadline and player.Parent do
			task.wait(JOIN_DATA_POLL)
			launchData, referredBy, raw = readJoinData(player)
		end
		if not player.Parent then
			return
		end
		raw.waited = math.floor((os.clock() - t0) * 10) / 10
		AffiliateReport.Join(player, launchData, referredBy, function(body)
			if player.Parent then
				self:_OnJoinResult(player, body)
			end
		end, raw)
	end)
end

function AffiliateService:KnitInit()
	self._trove = Trove.new()
end

function AffiliateService:KnitStart()
	self._trove:Connect(Players.PlayerAdded, function(player: Player)
		self:_OnPlayerAdded(player)
	end)
	self._trove:Connect(Players.PlayerRemoving, function(player: Player)
		self._launchData[player.UserId] = nil
	end)
	for _, player in Players:GetPlayers() do
		self:_OnPlayerAdded(player)
	end

	-- Client controller mungkin siap SESUDAH InviteReady pertama ditembak (KnitStart client
	-- jalan belakangan). Dia minta ulang, kita jawab dari cache.
	self.Client.RequestInviteReady:Connect(function(player: Player)
		local ld = self._launchData[player.UserId]
		if ld then
			self.Client.InviteReady:Fire(player, ld)
		end
	end)

	self._trove:Add(task.spawn(function()
		while true do
			task.wait(AffiliateReport.FLUSH_INTERVAL)
			AffiliateReport.FlushPending()
		end
	end))
end

return AffiliateService
