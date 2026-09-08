--!strict
--[[
	AffiliateController — sisi client afiliasi admin.

	Dua tugas, dua-duanya dipicu server (AffiliateService):
	  1. InviteReady(launchData): pemain ini admin aktif → tampilkan tombol "Undang teman".
	     Klik → SocialService:PromptGameInvite dengan ExperienceInviteOptions.LaunchData = ref_<KODE>.
	     Teman yang masuk lewat undangan itu datang dengan LaunchData yang sama persis seperti
	     share link, jadi backend nggak perlu tahu bedanya.
	  2. Notify(message): hasil undangan buat pengundang, mis. "X sekarang terikat ke kamu" atau
	     "X sudah terikat ke admin lain". Pakai SetCore SendNotification, pola yang sama dengan
	     CommandController (nggak butuh GUI apa pun).

	Tombolnya dibuat di sini (bukan instance di StarterGui) supaya nggak ada yang perlu
	ditaruh manual. Kalau mau ganti rupa, ubah `buildButton`. Undangan Roblox cuma bisa ke
	TEMAN; itu batasan Roblox, bukan kita.
]]

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local SocialService = game:GetService("SocialService")
local StarterGui = game:GetService("StarterGui")

local Knit = require(ReplicatedStorage.Packages.Knit)

local LOG_PREFIX = "[AffiliateController]"
local LocalPlayer = Players.LocalPlayer
--[[ Jarak minimal antar klik tombol, dan berapa lama sesudah prompt dibuka `false` dari Roblox
     dianggap cooldown (bukan "nggak tersedia"). Angka dari log tes live: false muncul 2-4 detik
     sesudah prompt sebelumnya, true lagi ~10 detik kemudian. ]]
local CLICK_COOLDOWN = 3
local PROMPT_COOLDOWN = 15

local AffiliateController = Knit.CreateController({ Name = "AffiliateController" })

local function notify(text: string, title: string?, seconds: number?)
	for attempt = 1, 5 do
		local ok = pcall(function()
			StarterGui:SetCore("SendNotification", {
				Title = title or "Afiliasi",
				Text = text,
				Duration = seconds or 6,
			})
		end)
		if ok then
			return
		end
		task.wait(1)
	end
	warn(`{LOG_PREFIX} SetCore SendNotification gagal terus: {text}`)
end

local function buildButton(): TextButton
	local gui = Instance.new("ScreenGui")
	gui.Name = "AffiliateInvite"
	gui.ResetOnSpawn = false
	gui.DisplayOrder = 5
	gui.IgnoreGuiInset = true

	local btn = Instance.new("TextButton")
	btn.Name = "InviteButton"
	btn.Size = UDim2.fromOffset(150, 36)
	btn.Position = UDim2.new(0, 16, 1, -56)
	btn.AnchorPoint = Vector2.new(0, 1)
	btn.BackgroundColor3 = Color3.fromRGB(46, 125, 255)
	btn.TextColor3 = Color3.new(1, 1, 1)
	btn.Font = Enum.Font.GothamBold
	btn.TextSize = 14
	btn.Text = "Undang teman"
	btn.AutoButtonColor = true
	btn.Parent = gui

	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 8)
	corner.Parent = btn

	gui.Parent = LocalPlayer:WaitForChild("PlayerGui")
	return btn
end

function AffiliateController:_ShowInviteButton(launchData: string)
	if self._button then
		self._launchData = launchData
		return
	end
	self._launchData = launchData
	local btn = buildButton()
	self._button = btn

	btn.Activated:Connect(function()
		--[[ Debounce. Hasil tes live 2026-09-07: CanSendGameInviteAsync balik `false` SEMENTARA kalau tombol
		     diklik lagi beberapa detik setelah prompt undangan dibuka/ditutup, lalu `true` lagi. Itu cooldown
		     Roblox, bukan "nggak tersedia" — jadi klik beruntun ditahan, dan false di dalam jendela
		     cooldown nggak boleh dibaca sebagai akun/perangkat yang nggak bisa undang. ]]
		local now = os.clock()
		if now - (self._lastClickAt or -math.huge) < CLICK_COOLDOWN then
			notify("Sabar, prompt undangan baru saja dibuka. Coba lagi beberapa detik.", "Undang teman", 3)
			return
		end
		self._lastClickAt = now

		local okCan, can = pcall(function()
			return SocialService:CanSendGameInviteAsync(LocalPlayer)
		end)
		-- Selalu ke log client (F9 > Client): kalau undangan nggak tersedia, di sini alasannya kelihatan.
		warn(`{LOG_PREFIX} CanSendGameInviteAsync ok={okCan} can={tostring(can)} studio={RunService:IsStudio()} placeId={game.PlaceId}`)
		if not okCan or not can then
			-- Di Studio SELALU false: prompt undangan cuma jalan di client Roblox asli. Bukan bug, jangan dicari.
			if RunService:IsStudio() then
				notify("Undangan Roblox nggak bisa dikirim dari Studio. Tombolnya udah muncul = backend mengenali kamu sebagai admin; tes kirimnya di server live.", "Undang teman", 8)
			elseif now - (self._lastPromptAt or -math.huge) < PROMPT_COOLDOWN then
				notify("Prompt undangan baru saja dipakai. Tunggu beberapa detik lalu coba lagi.", "Undang teman", 4)
			else
				-- Roblox menolak di luar jendela cooldown (privasi akun / perangkat). Jangan buntu: kasih share link-nya.
				notify("Undangan Roblox nggak tersedia di akun/perangkat ini. Pakai share link di kotak yang muncul.", "Undang teman", 6)
				self:_ShowShareLink()
			end
			return
		end
		self._lastPromptAt = now
		local options = Instance.new("ExperienceInviteOptions")
		options.LaunchData = self._launchData or launchData
		options.PromptMessage = "Ajak temanmu main. Yang masuk lewat undangan ini jadi undanganmu."
		-- Bukti di F9 bahwa prompt dibuka DENGAN LaunchData. Kalau teman masuk tanpa LaunchData padahal baris ini ada,
		-- masalahnya di pengiriman Roblox (teman nggak masuk lewat notifikasi, atau bug Roblox), bukan di kode ini.
		warn(`{LOG_PREFIX} PromptGameInvite dibuka, LaunchData={options.LaunchData}`)
		local ok, err = pcall(function()
			SocialService:PromptGameInvite(LocalPlayer, options)
		end)
		if not ok then
			warn(`{LOG_PREFIX} PromptGameInvite gagal: {err}`)
			notify("Gagal membuka undangan. Coba lagi.", "Undang teman", 5)
		end
	end)
end

--[[ Cadangan kalau undangan Roblox nggak tersedia: kotak berisi share link (TextBox read-only, bisa
     diseleksi & disalin di PC). Sekali klik "Tutup" hilang; klik tombol lagi buat munculin lagi. ]]
function AffiliateController:_ShowShareLink()
	local launchData = self._launchData
	if not launchData then
		return
	end
	local link = `https://www.roblox.com/games/start?placeId={game.PlaceId}&launchData={launchData}`
	if self._linkFrame then
		self._linkFrame.Visible = true
		self._linkBox.Text = link
		return
	end
	local gui = self._button and self._button.Parent
	if not gui then
		return
	end
	local frame = Instance.new("Frame")
	frame.Name = "ShareLink"
	frame.Size = UDim2.fromOffset(360, 96)
	frame.Position = UDim2.new(0, 16, 1, -100)
	frame.AnchorPoint = Vector2.new(0, 1)
	frame.BackgroundColor3 = Color3.fromRGB(28, 28, 32)
	frame.BackgroundTransparency = 0.05
	frame.Parent = gui
	local corner = Instance.new("UICorner"); corner.CornerRadius = UDim.new(0, 8); corner.Parent = frame

	local title = Instance.new("TextLabel")
	title.Size = UDim2.new(1, -16, 0, 22); title.Position = UDim2.fromOffset(8, 6)
	title.BackgroundTransparency = 1; title.TextXAlignment = Enum.TextXAlignment.Left
	title.Font = Enum.Font.GothamBold; title.TextSize = 13; title.TextColor3 = Color3.new(1, 1, 1)
	title.Text = "Share link kamu (salin, kirim ke teman)"; title.Parent = frame

	local box = Instance.new("TextBox")
	box.Size = UDim2.new(1, -16, 0, 28); box.Position = UDim2.fromOffset(8, 30)
	box.BackgroundColor3 = Color3.fromRGB(45, 45, 52); box.TextColor3 = Color3.new(1, 1, 1)
	box.Font = Enum.Font.Code; box.TextSize = 12; box.TextXAlignment = Enum.TextXAlignment.Left
	box.ClearTextOnFocus = false; box.TextEditable = false; box.Text = link; box.Parent = frame
	local bc = Instance.new("UICorner"); bc.CornerRadius = UDim.new(0, 6); bc.Parent = box

	local close = Instance.new("TextButton")
	close.Size = UDim2.fromOffset(70, 24); close.Position = UDim2.new(1, -78, 1, -30)
	close.BackgroundColor3 = Color3.fromRGB(70, 70, 80); close.TextColor3 = Color3.new(1, 1, 1)
	close.Font = Enum.Font.GothamBold; close.TextSize = 12; close.Text = "Tutup"; close.Parent = frame
	local cc = Instance.new("UICorner"); cc.CornerRadius = UDim.new(0, 6); cc.Parent = close
	close.Activated:Connect(function()
		frame.Visible = false
	end)

	self._linkFrame = frame
	self._linkBox = box
end

function AffiliateController:KnitStart()
	local service = Knit.GetService("AffiliateService")

	service.InviteReady:Connect(function(launchData: string)
		self:_ShowInviteButton(launchData)
	end)

	service.Notify:Connect(function(message: string, outcome: string?)
		notify(message, if outcome == "attributed" then "Undangan berhasil" else "Undangan", 8)
	end)

	-- Kalau server sudah nembak InviteReady sebelum controller ini siap, minta ulang.
	service.RequestInviteReady:Fire()
end

return AffiliateController
