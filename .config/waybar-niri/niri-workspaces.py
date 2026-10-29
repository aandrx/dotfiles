#!/usr/bin/env python3
import subprocess
import json

def get_workspaces():
    try:
        # Get workspace info from niri
        result = subprocess.run(['niri', 'msg', 'workspaces'], 
                              capture_output=True, text=True, timeout=1)
        
        if result.returncode == 0 and result.stdout:
            workspaces = json.loads(result.stdout)
            
            # Format workspaces like hyprland/workspaces
            output = []
            for ws in workspaces:
                idx = ws.get('idx')
                is_active = ws.get('is_active', False)
                
                if is_active:
                    output.append(f'<span foreground="#89b4fa">󰈹 {idx}</span>')
                else:
                    output.append(f'󰈹 {idx}')
            
            return ' '.join(output)
    except:
        pass
    
    # Fallback if niri msg fails
    return '󰈹 1 󰈹 2 󰈹 3 󰈹 4 󰈹 5'

if __name__ == "__main__":
    print(get_workspaces())
