# Building the APK

The build runs on **Expo's cloud servers**, not locally — you just need an Expo
account (free with your Student Pack) and the EAS CLI.

## One-time setup

```bash
npm install -g eas-cli
cd app
eas login              # log in with your expo.dev account
eas build:configure     # creates the project on Expo (uses eas.json)
```

## Build an installable APK (Android)

```bash
eas build --platform android --profile preview
```

This takes ~10-15 minutes on Expo's cloud. When done, you get a download link
for an `.apk` you can install directly on your phone (no Play Store needed).

Enable "Install from unknown sources" in Android settings first, then open the
download link on your phone and tap install.

## Build for iOS

```bash
eas build --platform ios --profile preview
```

This produces a build for the **iOS simulator**. To install on a real device you
need an Apple Developer account ($99/yr) and:

```bash
eas build --platform ios --profile production
```

## Don't forget

The app needs the **server running** somewhere reachable from your phone:

- **Same WiFi:** set `API_BASE` in `config.js` to your computer's LAN IP
  (`ifconfig | grep "inet "` → `http://192.168.x.x:8787`)
- **Remote:** deploy the server somewhere public and put that URL in `config.js`
- **Codespaces:** forward port 8787, set visibility Public, paste the URL

Rebuild after changing `config.js`:
```bash
eas build --platform android --profile preview
```
