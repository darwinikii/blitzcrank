const { setIntervalAsync, clearIntervalAsync } = require('set-interval-async');
const { authenticate, createWebSocketConnection } = require('league-connect');
const { app, BrowserWindow, ipcMain, Menu, Tray } = require('electron');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');
const Store = require('./Store.js');
const express = require('express')
const https = require('https');
const path = require('path');
const osIp = require("os");
const fs = require('fs');
const ip = require("ip");

console.log('Launching');

const sleep = (ms) => new Promise((resolve, reject) => setTimeout(resolve, ms))
const defaultPath = (args) => path.join(app.getAppPath("app"), args)

const exp = express()
exp.use(bodyParser.urlencoded({ extended: true }));
exp.use(express.json());
var expListener = exp.listen(3131)
expListener.close()

var credentials, window, websocket
var gameVersion, champIds = { nameToId: {}, idToName: {}, champs: [] }

const store = new Store({
  configName: 'user-preferences',
  defaults: {
    readycheck: false,
    inviteaccept: false,
    autoselect: { enabled: false, slots: [
      {
        character: "None",
        lane: "Any"
      },
      {
        character: "None",
        lane: "Any"
      },
      {
        character: "None",
        lane: "Any"
      },
      {
        character: "None",
        lane: "Any"
      },
      {
        character: "None",
        lane: "Any"
      }
    ] },
    autoban: { enabled: false, slots: [
      {
        character: "None",
        lane: "Any"
      },
      {
        character: "None",
        lane: "Any"
      },
      {
        character: "None",
        lane: "Any"
      }
    ] },
    inTray: false,
    companion: false
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
    fs.writeFileSync(defaultPath("APIdata.json"), JSON.stringify({ gameVersion: gameVersion, champIds: champIds }, null, 4))
  } catch (e) {
    try {
      var data = JSON.parse((fs.readFileSync(defaultPath("APIdata.json"))).toString())
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

      ws.on('close', async message => {
        credentials = undefined
        websocket = undefined
        window.webContents.send("playerIcon", {})
        setActivity({
          details: "Client isn't connected",
          startTimestamp: new Date(),
          largeImageKey: "logo"
        });
        await clientConnector()
      })
    } catch(e) {
      credentials = undefined
    }
    await sleep(1000)
  }
})

var subscribed = []
const mainThread = setIntervalAsync(async () => {
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
    var lane = await new Promise((resolve, reject) => {
      session.myTeam.forEach((e) => {
        if (e.cellId == localCell) {
          resolve(e.assignedPosition)
        }
      })
      resolve("")
    })
    
    lane = lane == "" ? "any" : lane

    console.log(lane)
    
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
      if (action.type == "pick") {
          if (!store.get("autoselect").enabled) return
          var selectList = store.get("autoselect").slots.map((e) => e = parseInt(champIds.nameToId[e.character]))
          console.log(selectList)
          var laneList = store.get("autoselect").slots.map((e) => e = e.lane)
          var allGrid = JSON.parse(await request("/lol-champ-select/v1/all-grid-champions/", "GET", credentials))
          allGrid = allGrid.filter((e) => {
            if (!selectList.includes(e.id)) return false
            e.userPreferredLane = laneList[selectList.indexOf(e.id)]
            if (e.disable == true) return false
            if (e.owned == false) return false
            if (session.bans.myTeamBans.includes(e.id) || session.bans.theirTeamBans.includes(e.id)) return false
            if (e.selectionStatus.pickedByOtherOrBanned == true) return false
            if (e.userPreferredLane != lane) return false
            return true
          })
          selectList = allGrid.sort((a, b) => selectList.indexOf(a.id) - selectList.indexOf(b.id))
          await sleep(1000)

          if (!selectList[0]) console.log("ALL DELETED")

          for (let i = 0; i < 5; i++) {
            if (!selectList[0]) continue
            console.log(selectList[0].name)
            console.log(selectList[0].userPreferredLane)
            await request("/lol-champ-select/v1/session/actions/" + action.id, "PATCH", credentials, { 'championId': selectList[0].id })
            await sleep(1000)
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
            if (selectionStatus.championId == selectList[0].id || newAction.championId == selectList[0].id) {
              await request("/lol-champ-select/v1/session/actions/" + action.id + "/complete", "POST", credentials)
              continue
            } 
            else selectList.shift()
          }

          return

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
          var banList = store.get("autoban").slots.map((e) => parseInt(champIds.nameToId[e.character]))
          console.log(banList)
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
}, 3000)

exp.get('/testConnection', (req, res) => {
  res.send({ status: "OK" })
})

exp.get('/getData', (req, res) => {
  res.send(store.data)
})

exp.get('/getChamps', (req, res) => {
  res.send({ champs: champIds.champs, ver: gameVersion })
})

exp.post('/setData', (req, res) => {
  console.log(req.body)
  window.webContents.send("sync", req.body)
  store.setAll(req.body)
  res.send({ status: "OK" })
})


const createWindow = async () => {
  const win = new BrowserWindow({
    title: "Blitzcrank",
    width: 700,
    height: 400,
    maximizable: false,
    resizable: false,
    frame: false,
    titleBarStyle: "hidden",
    icon: defaultPath("icons/1024x1024.png"),
    webPreferences: {
      preload: path.join(__dirname, "public", "preload.js"),
      nodeIntegration: true,
      contextIsolation: false
    },
  })

  if (store.get("inTray") == true) win.hide()
  win.loadFile(path.join(__dirname, "public", "index.html"))

  ipcMain.on("run", async () => {
    win.webContents.send("sync", store.data)
    if (store.data.companion == true) expListener = exp.listen(3131)
  });

  ipcMain.on("close", () => {
    win.close()
  });
  ipcMain.on("minimize", () => {
    win.hide()
    store.set("inTray", true)
  });

  ipcMain.on("setData", (event, data) => {
    if (store.data.companion != data.companion) {
      if (data.companion == true) {
        expListener = exp.listen(3131)
      } else {
        expListener.close()
      }
    }
    store.setAll(data)
    console.log(data)
  });

  ipcMain.handle('reqData', async (event, args) => {
    return store.data
  })
  
  ipcMain.handle('champlist', async (event, args) => {
    return { champs: champIds.champs, ver: gameVersion }
  })

  ipcMain.handle('hexIP', async (event, args) => {
    var ip = getUserIp()
    ip = ip == null ? "192.168.256.256" : ip
    return ipToHex(ip)
  })

  window = win
  clientConnector()
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

if (require('electron-squirrel-startup')) app.quit();

var tray
app.whenReady().then(async () => {
  await getAPIData()
  createWindow()

  tray = new Tray(defaultPath("icons/1024x1024.png"))

  var contextMenu = Menu.buildFromTemplate([
    { 
      label: 'Show App', 
      click: (e) => {
        window.show()
        store.set("inTray", false)
      } 
    },
    { label: 'Quit App', role: "quit" }
  ])
  tray.setContextMenu(contextMenu)
})

const getUserIp = () => {
  const ethernetIp = osIp.networkInterfaces()["Ethernet"];
  const wifiIp = osIp.networkInterfaces()["Wi-Fi"];

  const ethernetIpv4 =
    ethernetIp && ethernetIp.find((ip) => ip.family === "IPv4");
  const wifiIpv4 = wifiIp && wifiIp.find((ip) => ip.family === "IPv4");

  var userIp = null

  if (wifiIpv4 && ip.isPrivate(wifiIpv4.address)) {
    userIp = wifiIpv4.address;
  }

  if (ethernetIpv4 && ip.isPrivate(ethernetIpv4.address)) {
    userIp = ethernetIpv4.address;
  }

  return userIp
}

const ipToHex = (ipAddress) => {
  let hex = "";
  const octetos = ipAddress.split(".");
  for (let i = 0; i < octetos.length; i++) {
    let octetoHex = parseInt(octetos[i]).toString(16);
    if (octetoHex.length === 1) {
      octetoHex = "0" + octetoHex;
    }
    hex += octetoHex;
  }

  const code = hex.slice(4)
  return code;
}

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
  //console.log({ method: method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: "Basic "  + Buffer.from(`riot:${_credentials.password}`).toString('base64') }, body: body ? body : (method == "POST" ? {} : undefined), agent: new https.Agent(agentOptions)}
  return new Promise(async (resolve, reject) => {
    resolve(await req.text())
  })
}