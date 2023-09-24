const sleep = (ms) => new Promise((resolve, reject) => setTimeout(resolve, ms))
const { ipcRenderer } = require("electron")

var ver = "13.18.1"

window.onload = () => {
    new bootstrap.Tooltip(document.getElementById("playerIcon"))
    new bootstrap.Tooltip(document.getElementById("Logo"))
    new bootstrap.Tooltip(document.getElementById("MainMenuBtn"))
    new bootstrap.Tooltip(document.getElementById("AutomationBtn"))
    new bootstrap.Tooltip(document.getElementById("SettingsBtn"))
    new bootstrap.Tooltip(document.getElementById("playerIconErr"))

    ipcRenderer.invoke('champlist', "").then((result) => {
        ver = result.ver
        for(element of document.getElementsByClassName("characterSelector")) {
            result.champs.forEach(e => {
                var option = document.createElement("option")
                option.value = e
                option.innerText = e
                element.appendChild(option)
            });
        }
        for(element of document.getElementsByClassName("characterBanner")) {
            result.champs.forEach(e => {
                var option = document.createElement("option")
                option.value = e
                option.innerText = e
                element.appendChild(option)
            });
        }
    })

    ipcRenderer.invoke('reqData', "").then((result) => {
        if (result.companion == true) {
            ipcRenderer.invoke('hexIP', "").then((result) => {
                document.getElementById("hexcode").innerHTML = "Companion App"
                if (result.local != 100100) document.getElementById("hexcode").innerHTML += " [Local: " + result.local + "]" 
                if (result.global != null) document.getElementById("hexcode").innerHTML += " [Global: " + result.global + "]"
            })
        }
    })

    ipcRenderer.send("run");
}

ipcRenderer.on("hexIP", (event, data) => {
    ipcRenderer.invoke('reqData', "").then((result) => {
        if (result.companion == true) {
            document.getElementById("hexcode").innerHTML = "Companion App"
            if (data.local != 100100) document.getElementById("hexcode").innerHTML += " [Local: " + data.local + "]" 
            if (data.global != null) document.getElementById("hexcode").innerHTML += " [Global: " + data.global + "]"
        }
    })
});

ipcRenderer.on("sync", (event, data) => {
    document.getElementById("readycheck").checked = data.readycheck
    document.getElementById("inviteaccept").checked = data.inviteaccept
    document.getElementById("autoselect").checked = data.autoselect.enabled
    document.getElementById("autoban").checked = data.autoban.enabled
    document.getElementsByClassName("characterSelector")[0].value = data.autoselect.slots[0].character
    document.getElementsByClassName("characterSelector")[1].value = data.autoselect.slots[1].character
    document.getElementsByClassName("characterSelector")[2].value = data.autoselect.slots[2].character
    document.getElementsByClassName("characterSelector")[3].value = data.autoselect.slots[3].character
    document.getElementsByClassName("characterSelector")[4].value = data.autoselect.slots[4].character
    document.getElementsByClassName("laneSelector")[0].value = data.autoselect.slots[0].lane
    document.getElementsByClassName("laneSelector")[1].value = data.autoselect.slots[1].lane
    document.getElementsByClassName("laneSelector")[2].value = data.autoselect.slots[2].lane
    document.getElementsByClassName("laneSelector")[3].value = data.autoselect.slots[3].lane
    document.getElementsByClassName("laneSelector")[4].value = data.autoselect.slots[4].lane
    characterChangeImage(document.getElementsByClassName("characterSelector")[0], false)
    characterChangeImage(document.getElementsByClassName("characterSelector")[1], false)
    characterChangeImage(document.getElementsByClassName("characterSelector")[2], false)
    characterChangeImage(document.getElementsByClassName("characterSelector")[3], false)
    characterChangeImage(document.getElementsByClassName("characterSelector")[4], false)
    document.getElementsByClassName("characterBanner")[0].value = data.autoban.slots[0].character
    document.getElementsByClassName("characterBanner")[1].value = data.autoban.slots[1].character
    document.getElementsByClassName("characterBanner")[2].value = data.autoban.slots[2].character
    characterChangeImage(document.getElementsByClassName("characterBanner")[0], false)
    characterChangeImage(document.getElementsByClassName("characterBanner")[1], false)
    characterChangeImage(document.getElementsByClassName("characterBanner")[2], false)
    document.getElementById("companionSwitch").checked = data.companion

    console.log("Sync completed from main server : ")
    console.log(data)
})

ipcRenderer.on("playerIcon", (event, data) => {
    if (!data.displayName) { document.getElementById("playerIcon").style.display = "none"; document.getElementById("playerIconErr").style.display = "block"; return }
    document.getElementById("playerIcon").setAttribute("data-bs-title", data.displayName)
    document.getElementById("playerIcon").src = "https://ddragon.leagueoflegends.com/cdn/13.18.1/img/profileicon/" + data.profileIconId + ".png"
    document.getElementById("playerIcon").style.display = "block"
    document.getElementById("playerIconErr").style.display = "none"
})

function switchMenu(menu) {
    document.getElementsByClassName("MainMenu")[0].classList.value = "MainMenu hidden"
    document.getElementsByClassName("Automation")[0].classList.value= "Automation hidden"
    document.getElementsByClassName("Settings")[0].classList.value= "Settings hidden"

    document.getElementsByClassName(menu)[0].classList.value = document.getElementsByClassName(menu)[0].classList.value.replace("hidden", "")
}

function datachange() {
    var data = {}
    data.readycheck = document.getElementById("readycheck").checked
    data.inviteaccept = document.getElementById("inviteaccept").checked
    data.autoselect = { enabled: document.getElementById("autoselect").checked, slots: [] }
    data.autoban = { enabled: document.getElementById("autoban").checked, slots: [] }

    for(elmt in document.getElementsByClassName("characterSelector")) {
        if (document.getElementsByClassName("characterSelector")[elmt].value == undefined) continue
        data.autoselect.slots.push({
            character: document.getElementsByClassName("characterSelector")[elmt].value,
            lane: document.getElementsByClassName("laneSelector")[elmt].value
        });
    }

    for(elmt of document.getElementsByClassName("characterBanner")) {
        data.autoban.slots.push({
            character: elmt.value
        });
    }

    data.companion = document.getElementById("companionSwitch").checked

    console.log("New data : ")
    console.log(data)
    ipcRenderer.send("setData", data)
}

function switchCompanion(e) {
    e.setAttribute("disabled", false)
    if (e.checked == true) {
        ipcRenderer.invoke('hexIP', "").then((result) => {
            document.getElementById("hexcode").innerHTML = "Companion App"
            if (result.local != 100100) document.getElementById("hexcode").innerHTML += " [Local: " + result.local + "]" 
            if (result.global != null) document.getElementById("hexcode").innerHTML += " [Global: " + result.global + "]"
        })

        datachange()
    } else {
        document.getElementById("hexcode").innerHTML = "Companion App"
        datachange()
    }
    sleep(1000).then(() => {
        e.removeAttribute('disabled')
    })
}

function characterChangeImage(e, type) {
    if (e.value == "None") return  e.parentElement.children[0].src = ""
    e.parentElement.children[0].src = "http://ddragon.leagueoflegends.com/cdn/" + ver + "/img/champion/" + e.value + ".png"
    if (type == true) return datachange()
}