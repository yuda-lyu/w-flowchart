// 本套件唯一之瀏覽器啟動點: p1~p10 各產線之渲染一律經此啟動, 不直接依賴 playwright / playwright-core
//   經 w-playwright 啟動 headless shell(無頭之預設), 其於每次啟動合併出恰一串 --disable-features(含守門功能 AutofillAiWalletPrivatePasses),
//   使 Windows 上 Chromium 系瀏覽器每啟動一個新根行程時不再以錯誤密碼替目前使用者呼叫 LogonUser(10 分鐘內 10 次即鎖帳號)
//   不自動安裝受管瀏覽器: 缺檔時 reject 之 Error 帶 code 'E_BROWSER_MISSING', 取得方式(wpw.ensureChromium())見 README
import wpw from 'w-playwright'

async function launchBrowser() {
    return await wpw.launchChromium({ headless: true })
}

export default launchBrowser
