const { authenticate, createWebSocketConnection } = require('league-connect');
const { app, BrowserWindow, ipcMain } = require('electron')
const fetch = require('node-fetch');
const Store = require('./Store.js')
const https = require('https');
const path = require('path');

const sleep = (ms) => new Promise((resolve, reject) => setTimeout(resolve, ms))

var credentials, window, websocket, summonerId
var gameVersion, champIds = { nameToId: {}, idToName: {}, champs: [] }

const store = new Store({
  configName: 'user-preferences',
  defaults: {
    readycheck: false,
    inviteaccept: false,
    autoselect: { enabled: false, chracters: ["None", "None", "None"] }
  }
})

const getAPIData = async () => {
  const versions = await (await fetch("https://ddragon.leagueoflegends.com/api/versions.json")).json()
  const characters = await (await fetch("http://ddragon.leagueoflegends.com/cdn/" + versions[0] + "/data/en_US/champion.json")).json()
 
  Object.entries(characters.data).forEach((e, i, a) => {
    champIds.nameToId[e[0]] = e[1].key
    champIds.idToName[e[1].key] = e[0]
    champIds.champs.push(e[0])
  })
  gameVersion = versions[0]
} //selam

const clientConnector = (async() => { 
  while(credentials == undefined) {
    try {
      var client = await authenticate({ awaitConnection: true })
      while(true) {
        var summoner = JSON.parse(await request('/lol-summoner/v1/current-summoner', "GET", client))
        if (summoner.displayName) {
          window.webContents.send("playerIcon", summoner)
          break
        } else continue
      }
      credentials = client
      const ws = await createWebSocketConnection({
        authenticationOptions: {
          awaitConnection: true
        }
      })

      websocket = ws
      summonerId = JSON.parse(await request("/lol-login/v1/session", "GET", credentials)).summonerId

      ws.on('close', async message => {
        credentials = undefined
        websocket = undefined
        summonerId = undefined
        window.webContents.send("playerIcon", {})
        await clientConnector()
      })
    } catch(e) {
      credentials = undefined
    }
    await sleep(1000)
  }
})

var subscribed = []
const mainThread = setInterval(async () => {
  if (credentials == undefined) return
  var state = JSON.parse(await request('/lol-gameflow/v1/gameflow-phase', "GET", credentials))
  console.log(state)
  if (state == "None") {
    if (store.get("inviteaccept") == true) {
      if (websocket == undefined) return
      if (!subscribed.includes("/lol-lobby/v2/received-invitations")) {
        subscribed.push("/lol-lobby/v2/received-invitations")
        websocket.subscribe('/lol-lobby/v2/received-invitations', async (data, event) => {
          if (!data[0]) return
          await request('/lol-lobby/v2/received-invitations/' + data[0].invitationId + "/accept", "POST", credentials, {})
          websocket.unsubscribe('/lol-lobby/v2/received-invitations')
          delete subscribed[subscribed.indexOf("/lol-lobby/v2/received-invitations")]
        })
      }
    }
  } else if (state == "Lobby") {

  } else if (state == "ReadyCheck") {
    if (store.get("readycheck") == true) {
      await request("/lol-matchmaking/v1/ready-check/accept", "POST", credentials, {})
    }
  } else if (state == "Matchmaking") {

  } else if (state == "ChampSelect") {
    const session = JSON.parse(await request("/lol-champ-select/v1/session", "GET", credentials))
    var localCell = session.localPlayerCellId
    session.actions.pop().forEach((e, i, a) => {
      if (e.completed == true) return
      if (e.actorCellId == localCell) {
        if (e.type == "pick") {
          
        }
      }
    })
  }
}, 1000)

const createWindow = async () => {
  const win = new BrowserWindow({
    title: "Blitzcrank",
    width: 600,
    height: 300,
    maximizable: false,
    resizable: false,
    titleBarStyle: "hidden",
    icon: path.join(__dirname, "blitzcrank.png"),
    webPreferences: {
      preload: path.join(__dirname, "public", "preload.js"),
      nodeIntegration: true,
      contextIsolation: false
    }
  })
  
  win.loadFile(path.join(__dirname, "public", "index.html"))

  ipcMain.on("run", async () => {
    console.log("Hello World")
    win.webContents.send("sync", store.data)
  });

  ipcMain.on("close", () => {
    win.close()
  });
  ipcMain.on("minimize", () => {
    win.minimize()
  });

  ipcMain.on("data", (event, data) => {
    store.setAll(data)
    console.log(data)
  });
  
  ipcMain.handle('champlist', async (event, args) => {
    console.log(champIds.champs)
    return { champs: champIds.champs, ver: gameVersion }
  })

  window = win
  clientConnector()
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.whenReady().then(async () => {
  await getAPIData()
  createWindow()
})

const request = async (path, method, _credentials, body) => {
  if (_credentials == undefined) return console.log("Credentials Undefined")
  const agentOptions = !_credentials.certificate ? { rejectUnauthorized: false } : { ca: _credentials.certificate }
  var req = await fetch('https://127.0.0.1:' + _credentials.port + path, {
    method: method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: "Basic "  + Buffer.from(`riot:${_credentials.password}`).toString('base64')
    },
    body: body ? body : (method == "POST" ? {} : undefined),
    agent: new https.Agent(agentOptions)
  })
  //console.log({ method: method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: "Basic "  + Buffer.from(`riot:${_credentials.password}`).toString('base64') }, body: body ? body : (method == "POST" ? {} : undefined), agent: new https.Agent(agentOptions)})
  return new Promise(async (resolve, reject) => {
    resolve(await req.text())
  })
}