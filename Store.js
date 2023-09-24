const electron = require('electron');
const path = require('path');
const fs = require('fs');

class Store {
  constructor(opts) {
    const userDataPath = (electron.app || electron.remote.app).getPath('userData');
    this.path = path.join(userDataPath, opts.configName + '.json');
    this.data = parseDataFile(this.path, opts.defaults);
    this.opts = opts
  }

  get(key) {
    if (this.data[key] == undefined) return this.opts.defaults[key]
    else return this.data[key]
  }

  set(key, val) {
    this.data[key] = val;
    fs.writeFileSync(this.path, JSON.stringify(this.data));
  }

  setAll(val) {
    this.data = val
    fs.writeFileSync(this.path, JSON.stringify(this.data));
  }
}

function parseDataFile(filePath, defaults) {
  try {
    var readedData = JSON.parse(fs.readFileSync(filePath));
    Object.keys(defaults).forEach(e => {
      if (!readedData[e]) readedData[e] = defaults[e]
    })
    return readedData
  } catch(error) {
    return defaults;
  }
}

module.exports = Store;