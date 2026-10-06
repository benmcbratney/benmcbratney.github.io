# Home Assistant on a Mac mini (Apple silicon)

A step-by-step guide to running Home Assistant for free in a virtual machine on an
M-series Mac mini (written for a 2023 M2 model). This is the full **Home Assistant OS**,
the same thing a Home Assistant Green runs, add-on store included. Plan on about an
hour, most of it waiting.

> If a menu name below doesn't match what you see, UTM probably renamed it in a newer
> version. Home Assistant's own guide is the source of truth:
> home-assistant.io → Installation → Alternative.

**Why a virtual machine and not Docker?** The Docker version of Home Assistant has no
add-on store. On a Mac, Docker also doesn't sit directly on your home network, so
automatic device discovery (Kasa, WiZ, Roomba, …) tends to fail. A virtual machine
with bridged networking avoids both problems.

---

## Before you start

- **Plug the Mac mini into your router with Ethernet** if you can. Bridged networking
  (step 2) is more reliable over a cable than over Wi-Fi.
- About **40 GB of free disk space**.
- A browser on the Mac.

## 1. Download the two pieces

1. **UTM** (free): download it from **mac.getutm.app** and drag it into Applications.
2. **Home Assistant OS for Apple silicon:** go to
   **github.com/home-assistant/operating-system/releases**, open the newest release
   (not one marked "Pre-release") and download the file named
   **`haos_generic-aarch64-<version>.qcow2.xz`**.
   - `aarch64` is the version for Apple chips. Make sure it's the `.qcow2.xz` file, not `.img.xz`.
3. Double-click the `.xz` file to unzip it. You'll get a `.qcow2` file. That's the
   Home Assistant "hard drive". Put it somewhere it'll stay, like `Documents`.

## 2. Create the virtual machine

1. Open UTM → **Create a New Virtual Machine** → **Virtualize** → **Other**.
2. On the boot-image screen, check **Skip ISO boot** and click Continue.
3. **Hardware:** Memory **4096 MB**, CPU cores **2**. Continue.
4. **Storage:** leave the default (you'll delete it in a moment). Continue.
5. **Shared Directory:** skip. Continue.
6. **Summary:** name it exactly **`Home Assistant`** (the auto-start script in step 4
   uses this name), check **Open VM Settings**, and click **Save**.
7. In the settings window that opens:
   - **System:** confirm **UEFI Boot** is on (it's the default).
   - **Drives:** select the blank drive UTM created and **Delete** it. Then
     **New… → Import…**, pick your `.qcow2` file, and set the interface to **VirtIO**.
   - **Network:** Network Mode **Bridged (Advanced)**. Bridged Interface: your
     **Ethernet** port (often `en0`). If you're on Wi-Fi only, pick the Wi-Fi interface.
   - Click **Save**.

## 3. First boot

1. Select **Home Assistant** in UTM and press **▶ Play**.
2. A window opens and shows text scrolling by, or stays mostly blank. Both are normal.
   **First boot takes about 5 minutes.**
3. On the Mac, open **http://homeassistant.local:8123**.
   - If it doesn't load, wait a few more minutes and refresh.
   - Still nothing? Look in your router's app for a new device called `homeassistant`
     and open `http://<its IP address>:8123`.
4. Click **Create my smart home**, make your account (save the password in your
   password manager), and set your home location and units.

## 4. Keep it running 24/7

Home Assistant is only up while the Mac mini is awake and the VM is running. These
settings handle sleep, power outages and macOS updates.

1. **System Settings → Energy:** turn on **Prevent automatic sleeping when the display
   is off** and **Start up automatically after a power failure**.
2. **System Settings → Users & Groups → Automatically log in as:** your user.
   (FileVault disk encryption blocks automatic login. If FileVault is on, the Mac will
   wait at the password screen after a power outage until someone logs in.)
3. **Start the VM at login.** UTM doesn't have a built-in "start at login" switch
   that we know of, so use a tiny helper app:
   1. Open **Script Editor** (Applications → Utilities) and paste:
      ```applescript
      delay 20 -- give the network a moment after login
      tell application "UTM"
          set vm to virtual machine named "Home Assistant"
          start vm
      end tell
      ```
   2. **File → Export…**, File Format **Application**, name it
      `Start Home Assistant`, and save it in Applications.
   3. Run it once by double-clicking. macOS will ask to let it control UTM: click **OK**.
   4. **System Settings → General → Login Items → +** and add `Start Home Assistant`.
4. **Test it:** restart the Mac. Within a few minutes of logging in,
   `homeassistant.local:8123` should come back on its own.

## 5. Back it up before you add anything

**Settings → System → Backups:** turn on **automatic backups**. Add a second backup
location outside the VM (Home Assistant can send backups to Google Drive). If the Mac
dies, or you move to a Home Assistant Green later, restoring a backup brings
everything back with no re-setup.

## 6. Add your devices

Many devices show up on their own under **Settings → Devices & services → Discovered**.
Click **Add** on each one. For the rest: **Add integration** and search the name.

| Brand | How it connects | Notes |
|---|---|---|
| **Kasa** (TP-Link) | Home Wi-Fi, usually auto-discovered | Search "TP-Link Smart Home" if it doesn't appear |
| **WiZ** | Home Wi-Fi, usually auto-discovered | |
| **iRobot** (Roomba) | Home Wi-Fi | The setup screen tells you to hold the Home button on the Roomba to pair |
| **Govee** | Home Wi-Fi | First turn on **LAN Control** for each device in the Govee app, then add "Govee lights local" |
| **VeSync** | Your VeSync login | |
| **Ring** | Your Ring login + 2-step code | |
| **Blink** | Your Blink login + 2-step code | |
| **Nest** | Google Device Access | Needs its own Google setup, similar to the hub's thermostat card. Follow the guide on the Nest integration page |
| **Dreo** | Needs HACS (below) | Community add-on |

**HACS (community add-on store):** needed for Dreo and other add-ons that don't ship
with Home Assistant. Install it using the official guide at **hacs.xyz**. Community
add-ons aren't reviewed by the Home Assistant team, so stick to popular ones.

## 7. When you're ready to connect the wall hub

Two more pieces, which we'll do together:

1. **A long-lived access token:** in Home Assistant, click your name (bottom left) →
   **Security** → **Long-lived access tokens** → Create. Treat it like a password. It
   goes into the Cloudflare Worker as a Secret, never into this repo.
2. **A free Cloudflare Tunnel** so the Worker can reach Home Assistant securely
   without opening any ports on your router.

## Troubleshooting

- **`homeassistant.local` never loads:** check the VM's Network Mode is
  **Bridged**, not Shared, and that it's bridged to the interface the Mac actually uses.
- **Devices aren't discovered:** same cause (bridged networking). Also make sure the
  devices and the Mac are on the same Wi-Fi network, not a guest network.
- **Everything stopped working:** the Mac probably restarted for an update and the VM
  didn't start. Open UTM and press Play, then check step 4.3.
- **Mac feels slow:** the VM is set to 4 GB of memory and 2 cores. Home Assistant
  runs fine on 2048 MB if you need it back.
