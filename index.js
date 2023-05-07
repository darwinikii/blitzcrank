const { setIntervalAsync, clearIntervalAsync } = require('set-interval-async');
const { authenticate, createWebSocketConnection } = require('league-connect');
const { app, BrowserWindow, ipcMain } = require('electron')
const fetch = require('node-fetch');
const Store = require('./Store.js')
const https = require('https');
const path = require('path');
const fs = require('fs');

const sleep = (ms) => new Promise((resolve, reject) => setTimeout(resolve, ms))

var credentials, window, websocket, summonerId
var gameVersion, champIds = { nameToId: {}, idToName: {}, champs: [] }

const store = new Store({
  configName: 'user-preferences',
  defaults: {
    readycheck: false,
    inviteaccept: false,
    autoselect: { enabled: false, characters: ["None", "None", "None"] },
    autoban: { enabled: false, characters: ["None", "None", "None"] }
  }
})

const getAPIData = async () => {
  try {
    const versions = await (await fetch("https://ddragon.leagueoflegends.com/api/versions.json")).json()
    const characters = await (await fetch("http://ddragon.leagueoflegends.com/cdn/" + versions[0] + "/data/en_US/champion.json")).json()
 
    Object.entries(characters.data).forEach((e, i, a) => {
      champIds.nameToId[e[0]] = e[1].key
      champIds.idToName[e[1].key] = e[0]
      champIds.champs.push(e[0])
    })
    gameVersion = versions[0]
    fs.writeFileSync("./APIdata.json", JSON.stringify({ gameVersion: gameVersion, champIds: champIds }, null, 4))
  } catch (e) {
    try {
      var data = JSON.parse((fs.readFileSync("./APIdata.json")).toString())
      gameVersion = data.gameVersion
      champIds = data.champIds
    } catch(e) {
      console.error(e)
    }
  }
}

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
var championIdx = 0
const mainThread = setIntervalAsync(async () => {
  if (championIdx >= store.get("autoselect").characters.length) {
    championIdx = 0
  }

  if (credentials == undefined) return
  var state = JSON.parse(await request('/lol-gameflow/v1/gameflow-phase', "GET", credentials))
  console.log(state)

  if (championIdx != 0 && state != "ChampSelect") {
    championIdx = 0
  }

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
    var allActions = []
    session.actions.forEach((row) => {
      row.forEach((cell) => {
        if (cell.completed == true) return
        if (cell.isInProgress == false) return
        if (cell.actorCellId != localCell) return
        allActions.push(cell)
      })
    })

    for (action of allActions) {
      if (action.completed == true) continue
      if (action.actorCellId == localCell) {
        if (action.type == "pick") {
          if (!store.get("autoselect").enabled) return
          var selectList = store.get("autoselect").characters.map((e) => e = parseInt(champIds.nameToId[e]))
          var allGrid = JSON.parse(await request("/lol-champ-select/v1/all-grid-champions/", "GET", credentials))
          allGrid = allGrid.filter((e) => {
            if (!selectList.includes(e.id)) return false
            if (e.disable == true) return false
            if (e.owned == false) return false
            if (session.bans.myTeamBans.includes(e.id) || session.bans.theirTeamBans.includes(e.id)) return false
            if (e.selectionStatus.pickedByOtherOrBanned == true) return false
            return true
          })
          selectList = allGrid.sort((a, b) => selectList.indexOf(a.id) - selectList.indexOf(b.id))
          await sleep(1000)

          if (!selectList[0]) return
          await request("/lol-champ-select/v1/session/actions/" + action.id, "PATCH", credentials, { 'championId': selectList[0].id })
          await sleep(2000)
          var selectionStatus = JSON.parse(await request("/lol-champ-select/v1/summoners/" + localCell, "GET", credentials))
          var newAction = await new Promise(async (resolve, reject) => {
            JSON.parse(await request("/lol-champ-select/v1/session/", "GET", credentials)).actions.forEach((row) => {
              row.forEach((cell) => {
                if (cell.completed == true) return
                if (cell.isInProgress == false) return
                if (cell.actorCellId != localCell) return
                if (cell.id != action.id) return
                resolve(cell)
              })
            })
          })
          if (selectionStatus.championId == selectList[0].id || newAction.championId == selectList[0].id) return await request("/lol-champ-select/v1/session/actions/" + action.id + "/complete", "POST", credentials)
          else selectList.shift()

          if (!selectList[0]) return
          await request("/lol-champ-select/v1/session/actions/" + action.id, "PATCH", credentials, { 'championId': selectList[0].id })
          await sleep(2000)
          var selectionStatus = JSON.parse(await request("/lol-champ-select/v1/summoners/" + localCell, "GET", credentials))
          var newAction = await new Promise(async (resolve, reject) => {
            JSON.parse(await request("/lol-champ-select/v1/session/", "GET", credentials)).actions.forEach((row) => {
              row.forEach((cell) => {
                if (cell.completed == true) return
                if (cell.isInProgress == false) return
                if (cell.actorCellId != localCell) return
                if (cell.id != action.id) return
                resolve(cell)
              })
            })
          })
          if (selectionStatus.championId == selectList[0].id || newAction.championId == selectList[0].id) return await request("/lol-champ-select/v1/session/actions/" + action.id + "/complete", "POST", credentials)
          else selectList.shift()

          if (!selectList[0]) return
          await request("/lol-champ-select/v1/session/actions/" + action.id, "PATCH", credentials, { 'championId': selectList[0].id })
          await sleep(2000)
          var selectionStatus = JSON.parse(await request("/lol-champ-select/v1/summoners/" + localCell, "GET", credentials))
          var newAction = await new Promise(async (resolve, reject) => {
            JSON.parse(await request("/lol-champ-select/v1/session/", "GET", credentials)).actions.forEach((row) => {
              row.forEach((cell) => {
                if (cell.completed == true) return
                if (cell.isInProgress == false) return
                if (cell.actorCellId != localCell) return
                if (cell.id != action.id) return
                resolve(cell)
              })
            })
          })
          if (selectionStatus.championId == selectList[0].id || newAction.championId == selectList[0].id) return await request("/lol-champ-select/v1/session/actions/" + action.id + "/complete", "POST", credentials)
          else selectList.shift()
        }
        if (action.type == "ban") {
          if (!store.get("autoban").enabled) return
          var myTeamPickIntent = session.myTeam.map((e) => e.championId == 0 ? e.championPickIntent : e.championId)
          var banList = store.get("autoban").characters.map((e) => parseInt(champIds.nameToId[e]))
          var allGrid = JSON.parse(await request("/lol-champ-select/v1/all-grid-champions/", "GET", credentials))
          allGrid = allGrid.filter((e) => {
            if (!banList.includes(e.id)) return false
            if (e.disable == true) return false
            if (e.selectionStatus.pickIntented == true && e.selectionStatus.pickIntentedByMe == false) return false
            if (session.bans.myTeamBans.includes(e.id) || session.bans.theirTeamBans.includes(e.id)) return false
            if (e.selectionStatus.pickedByOtherOrBanned == true) return false
            if (myTeamPickIntent.includes(e.id)) return false
            return true
          })
          banList = allGrid.sort((a, b) => banList.indexOf(a.id) - banList.indexOf(b.id))
          await sleep(1000)

          if (!banList[0]) return
          await request("/lol-champ-select/v1/session/actions/" + action.id, "PATCH", credentials, { 'championId': banList[0].id })
          await sleep(2000)
          var selectionStatus = JSON.parse(await request("/lol-champ-select/v1/summoners/" + localCell, "GET", credentials))
          var newAction = await new Promise(async (resolve, reject) => {
            JSON.parse(await request("/lol-champ-select/v1/session/", "GET", credentials)).actions.forEach((row) => {
              row.forEach((cell) => {
                if (cell.completed == true) return
                if (cell.isInProgress == false) return
                if (cell.actorCellId != localCell) return
                if (cell.id != action.id) return
                resolve(cell)
              })
            })
          })
          if (selectionStatus.banIntentSquarePortratPath.includes(banList[0].id) || newAction.championId == banList[0].id) return await request("/lol-champ-select/v1/session/actions/" + action.id + "/complete", "POST", credentials)
          else banList.shift()

          await request("/lol-champ-select/v1/session/actions/" + action.id, "PATCH", credentials, { 'championId': banList[0].id })
          await sleep(2000)
          var selectionStatus = JSON.parse(await request("/lol-champ-select/v1/summoners/" + localCell, "GET", credentials))
          var newAction = await new Promise(async (resolve, reject) => {
            JSON.parse(await request("/lol-champ-select/v1/session/", "GET", credentials)).actions.forEach((row) => {
              row.forEach((cell) => {
                if (cell.completed == true) return
                if (cell.isInProgress == false) return
                if (cell.actorCellId != localCell) return
                if (cell.id != action.id) return
                resolve(cell)
              })
            })
          })
          if (selectionStatus.banIntentSquarePortratPath.includes(banList[0].id) || newAction.championId == banList[0].id) return await request("/lol-champ-select/v1/session/actions/" + action.id + "/complete", "POST", credentials)
          else banList.shift()

          await request("/lol-champ-select/v1/session/actions/" + action.id, "PATCH", credentials, { 'championId': banList[0].id })
          await sleep(2000)
          var selectionStatus = JSON.parse(await request("/lol-champ-select/v1/summoners/" + localCell, "GET", credentials))
          var newAction = await new Promise(async (resolve, reject) => {
            JSON.parse(await request("/lol-champ-select/v1/session/", "GET", credentials)).actions.forEach((row) => {
              row.forEach((cell) => {
                if (cell.completed == true) return
                if (cell.isInProgress == false) return
                if (cell.actorCellId != localCell) return
                if (cell.id != action.id) return
                resolve(cell)
              })
            })
          })
          if (selectionStatus.banIntentSquarePortratPath.includes(banList[0].id) || newAction.championId == banList[0].id) return await request("/lol-champ-select/v1/session/actions/" + action.id + "/complete", "POST", credentials)
          else banList.shift()
        }
      }
    }
  }
}, 3000)

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
    body: body ? JSON.stringify(body) : (method == "POST" ? {} : undefined),
    agent: new https.Agent(agentOptions)
  })
  //console.log({ method: method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: "Basic "  + Buffer.from(`riot:${_credentials.password}`).toString('base64') }, body: body ? body : (method == "POST" ? {} : undefined), agent: new https.Agent(agentOptions)})
  return new Promise(async (resolve, reject) => {
    resolve(await req.text())
  })
}