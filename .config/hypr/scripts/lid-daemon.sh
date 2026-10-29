#!/bin/bash

# Set environment
export DISPLAY=:0
export WAYLAND_DISPLAY=wayland-1
export XDG_RUNTIME_DIR=/run/user/$(id -u)

echo "Lid monitor daemon starting..." >> /tmp/lid-monitor.log
echo "User: $(whoami), UID: $(id -u)" >> /tmp/lid-monitor.log

LAST_STATE=""

while true; do
    if [ -f /proc/acpi/button/lid/LID0/state ]; then
        CURRENT_STATE=$(cat /proc/acpi/button/lid/LID0/state | awk '{print $2}')
        
        if [ "$CURRENT_STATE" != "$LAST_STATE" ]; then
            echo "$(date): Lid state changed from '$LAST_STATE' to '$CURRENT_STATE'" >> /tmp/lid-monitor.log
            
            # Run the handler
            "$HOME/.config/hypr/scripts/lid-handler.sh"
            
            LAST_STATE="$CURRENT_STATE"
        fi
    else
        echo "$(date): Could not read lid state" >> /tmp/lid-monitor.log
    fi
    
    sleep 1
done
