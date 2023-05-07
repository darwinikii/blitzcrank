const { ipcRenderer } = require("electron")

var ver = "13.9.1"

window.onload = () => {
    new bootstrap.Tooltip(document.getElementById("playerIcon"))
    new bootstrap.Tooltip(document.getElementById("Logo"))
    new bootstrap.Tooltip(document.getElementById("MainMenuBtn"))
    new bootstrap.Tooltip(document.getElementById("AutomationBtn"))
    new bootstrap.Tooltip(document.getElementById("playerIconErr"))

    ipcRenderer.invoke('champlist', "").then((result) => {
        ver = result.ver
        var elements = []
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

    ipcRenderer.send("run");
}

ipcRenderer.on("sync", (event, data) => {
    console.log(data)
    document.getElementById("readycheck").checked = data.readycheck
    document.getElementById("inviteaccept").checked = data.inviteaccept
    document.getElementById("autoselect").checked = data.autoselect.enabled
    document.getElementById("autoban").checked = data.autoban.enabled
    document.getElementsByClassName("characterSelector")[0].value = data.autoselect.characters[0]
    document.getElementsByClassName("characterSelector")[1].value = data.autoselect.characters[1]
    document.getElementsByClassName("characterSelector")[2].value = data.autoselect.characters[2]
    document.getElementsByClassName("characterSelector")[0].onchange()
    document.getElementsByClassName("characterSelector")[1].onchange()
    document.getElementsByClassName("characterSelector")[2].onchange()
    document.getElementsByClassName("characterBanner")[0].value = data.autoban.characters[0]
    document.getElementsByClassName("characterBanner")[1].value = data.autoban.characters[1]
    document.getElementsByClassName("characterBanner")[2].value = data.autoban.characters[2]
    document.getElementsByClassName("characterBanner")[0].onchange()
    document.getElementsByClassName("characterBanner")[1].onchange()
    document.getElementsByClassName("characterBanner")[2].onchange()
})

ipcRenderer.on("playerIcon", (event, data) => {
    if (!data.displayName) { document.getElementById("playerIcon").style.display = "none"; document.getElementById("playerIconErr").style.display = "block"; return }
    document.getElementById("playerIcon").setAttribute("data-bs-title", data.displayName)
    document.getElementById("playerIcon").src = "https://ddragon.leagueoflegends.com/cdn/13.8.1/img/profileicon/" + data.profileIconId + ".png"
    document.getElementById("playerIcon").style.display = "block"
    document.getElementById("playerIconErr").style.display = "none"
})

function switchMenu(menu) {
    document.getElementsByClassName("MainMenu")[0].classList.value = "MainMenu hidden"
    document.getElementsByClassName("Automation")[0].classList.value= "Automation hidden"

    document.getElementsByClassName(menu)[0].classList.value = document.getElementsByClassName(menu)[0].classList.value.replace("hidden", "")
}

function datachange() {
    console.log("datachange")
    var data = {}
    data.readycheck = document.getElementById("readycheck").checked
    data.inviteaccept = document.getElementById("inviteaccept").checked
    data.autoselect = { enabled: document.getElementById("autoselect").checked, characters: [] }
    data.autoban = { enabled: document.getElementById("autoban").checked, characters: [] }
    for(elmt of document.getElementsByClassName("characterSelector")) {
        data.autoselect.characters.push(elmt.value);
    }
    for(elmt of document.getElementsByClassName("characterBanner")) {
        data.autoban.characters.push(elmt.value);
    }
    ipcRenderer.send("data", data)
}

function characterChangeImage(e) {
    if (e.value == "None") return  e.parentElement.children[0].src = ""
    e.parentElement.children[0].src = "http://ddragon.leagueoflegends.com/cdn/" + ver + "/img/champion/" + e.value + ".png"
}