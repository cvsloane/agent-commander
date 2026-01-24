# agentd

`agentd` runs on each host and manages tmux sessions, streams console output, and forwards events to the control plane.

## Install
```bash
cd agents/agentd
go build -o agentd ./cmd/agentd
sudo cp agentd /usr/local/bin/
```

## Configure
Copy the example config:
```bash
sudo mkdir -p /etc/agentd
sudo cp agents/agentd/config.example.yaml /etc/agentd/config.yaml
```

## Run (systemd)
```bash
sudo cp deploy/systemd/agentd.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now agentd
```
