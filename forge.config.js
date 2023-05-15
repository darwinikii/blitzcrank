module.exports = {
  packagerConfig: {
    asar: true,
    icon: "./icons/icon.ico",
    ignore: [
      "APIdata.json",
      ".vscode",
      "forge.config.js"
    ]
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        setupIcon: "./icons/icon.ico"
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
    {
      name: '@electron-forge/maker-deb',
      config: {},
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {},
    },
  ],
  publishers: [
    {
      name: '@electron-forge/publisher-github',
      config: {
        repository: {
          owner: 'darwinikii',
          name: 'blitzcrank'
        },
        prerelease: false,
        authToken: process.env.GITHUB_TOKEN,
        draft: false
      }
    }
  ]
};
