# port-monitor

A terminal UI for monitoring open ports on your machine, built with [Ink](https://github.com/vadimdemedes/ink).

## Requirements

- macOS or Linux
- Node.js >= 18

> Uses `lsof` internally. Windows is not supported.

## Install

```bash
npm install -g app-port-monitor
```

Or run without installing:

```bash
npx app-port-monitor
```

## Usage

```bash
port-monitor
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `/` | Toggle filter input |
| `s` | Cycle sort: port / pid / name |
| `t` | Cycle scope: user / system / all |
| `p` | Cycle protocol: all / tcp / udp |
| `↑` `↓` | Scroll |
| `q` | Quit |

## Features

- Auto-refreshes every 5 seconds
- Filter by port number, process name, PID, or protocol
- Scope filter separates system ports (<= 1024) from user ports (> 1024)
- Scrollbar indicator when results exceed terminal height

## License

MIT
