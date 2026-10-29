#!/bin/bash
# Waybar Config Layout Switcher Script
# Quick layout switcher for Waybar using symlinks
# Uses the arch-hyprland waybar configuration structure
# Default config: window middle

IFS=$'\n\t'

# Define directories
WAYBAR_CONFIGS="$HOME/.config/waybar/configs"
WAYBAR_CONFIG_LINK="$HOME/.config/waybar/config"
SCRIPTSDIR="$HOME/.config/hypr/scripts"
DEFAULT_CONFIG="window middle"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to display available configs
list_configs() {
    echo -e "${BLUE}Available Waybar Configs:${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    local index=1
    while IFS= read -r file; do
        if [ -f "$WAYBAR_CONFIGS/$file" ]; then
            # Check if this is the current config
            if [ -L "$WAYBAR_CONFIG_LINK" ]; then
                local current=$(readlink "$WAYBAR_CONFIG_LINK")
                if [[ "$current" == *"$file" ]]; then
                    echo -e "  ${GREEN}[$index]${NC} ${GREEN}✓${NC} $file ${GREEN}(active)${NC}"
                else
                    echo -e "  ${YELLOW}[$index]${NC}   $file"
                fi
            else
                echo -e "  ${YELLOW}[$index]${NC}   $file"
            fi
            
            # Mark default config
            if [[ "$file" == "$DEFAULT_CONFIG" ]]; then
                echo -e "       ${BLUE}(default)${NC}"
            fi
            
            index=$((index + 1))
        fi
    done < <(find -L "$WAYBAR_CONFIGS" -maxdepth 1 -type f -exec basename {} \; | sort)
    
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

# Function to apply selected config
apply_config() {
    local config_name="$1"
    local config_path="$WAYBAR_CONFIGS/${config_name}"
    
    if [ ! -f "$config_path" ]; then
        echo -e "${RED}Error: Config '$config_name' not found!${NC}"
        return 1
    fi
    
    echo -e "${BLUE}Applying config:${NC} $config_name"
    
    # Create symlink
    ln -sf "$config_path" "$WAYBAR_CONFIG_LINK"
    
    echo -e "${GREEN}✓${NC} Config symlink created: config → configs/$config_name"
    
    # Restart waybar
    if [ -f "$SCRIPTSDIR/wbrestart.sh" ]; then
        echo -e "${BLUE}Restarting Waybar...${NC}"
        "$SCRIPTSDIR/wbrestart.sh" &
        sleep 0.5
        echo -e "${GREEN}✓${NC} Waybar restarted successfully"
    else
        echo -e "${YELLOW}Warning: Restart script not found. Restarting manually...${NC}"
        killall -9 waybar 2>/dev/null
        waybar &
        sleep 0.5
        echo -e "${GREEN}✓${NC} Waybar restarted"
    fi
}

# Function to apply default config
apply_default() {
    echo -e "${BLUE}Applying default config:${NC} $DEFAULT_CONFIG"
    apply_config "$DEFAULT_CONFIG"
}

# Function to show current config
show_current() {
    if [ -L "$WAYBAR_CONFIG_LINK" ]; then
        local current=$(readlink "$WAYBAR_CONFIG_LINK")
        local config_name=$(basename "$current")
        echo -e "${BLUE}Current config:${NC} ${GREEN}$config_name${NC}"
        
        if [[ "$config_name" == "$DEFAULT_CONFIG" ]]; then
            echo -e "${BLUE}Status:${NC} ${GREEN}Using default config${NC}"
        fi
    else
        echo -e "${YELLOW}No config symlink found${NC}"
        echo -e "${BLUE}Tip:${NC} Run '$0 --default' to set up default config"
    fi
}

# Function to show config preview
show_preview() {
    local config_name="$1"
    local config_path="$WAYBAR_CONFIGS/${config_name}"
    
    if [ ! -f "$config_path" ]; then
        echo -e "${RED}Error: Config '$config_name' not found!${NC}"
        return 1
    fi
    
    echo -e "${BLUE}Preview of config:${NC} $config_name"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    # Show modules-left, modules-center, modules-right
    echo -e "${YELLOW}Modules Layout:${NC}"
    grep -A 5 "modules-left" "$config_path" | head -6
    grep -A 5 "modules-center" "$config_path" | head -6
    grep -A 5 "modules-right" "$config_path" | head -6
    
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

# Main menu function
interactive_menu() {
    clear
    echo -e "${BLUE}╔═══════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║${NC}     ${GREEN}Waybar Config Switcher${NC}            ${BLUE}║${NC}"
    echo -e "${BLUE}╚═══════════════════════════════════════════╝${NC}"
    echo ""
    
    show_current
    echo ""
    list_configs
    echo ""
    echo -e "${BLUE}Options:${NC}"
    echo -e "  ${YELLOW}[number]${NC}  - Select config by number"
    echo -e "  ${YELLOW}[name]${NC}    - Select config by name"
    echo -e "  ${YELLOW}d${NC}         - Apply default config ($DEFAULT_CONFIG)"
    echo -e "  ${YELLOW}p [name]${NC}  - Preview config"
    echo -e "  ${YELLOW}q${NC}         - Quit"
    echo ""
    echo -e "${BLUE}Enter your choice:${NC} "
    read -r choice
    
    case "$choice" in
        q|Q)
            echo -e "${YELLOW}Exiting...${NC}"
            exit 0
            ;;
        d|D)
            apply_default
            ;;
        p|P)
            echo -e "${BLUE}Enter config name to preview:${NC} "
            read -r preview_name
            show_preview "$preview_name"
            echo ""
            echo -e "Press Enter to continue..."
            read
            interactive_menu
            ;;
        *)
            # Check if input is a number
            if [[ "$choice" =~ ^[0-9]+$ ]]; then
                local index=1
                while IFS= read -r file; do
                    if [ -f "$WAYBAR_CONFIGS/$file" ]; then
                        if [ "$index" -eq "$choice" ]; then
                            apply_config "$file"
                            return 0
                        fi
                        index=$((index + 1))
                    fi
                done < <(find -L "$WAYBAR_CONFIGS" -maxdepth 1 -type f -exec basename {} \; | sort)
                
                echo -e "${RED}Invalid selection${NC}"
            else
                # Treat as config name
                apply_config "$choice"
            fi
            ;;
    esac
}

# Parse command line arguments
case "${1:-}" in
    -l|--list)
        show_current
        echo ""
        list_configs
        ;;
    -c|--current)
        show_current
        ;;
    -d|--default)
        apply_default
        ;;
    -p|--preview)
        if [ -n "$2" ]; then
            show_preview "$2"
        else
            echo -e "${RED}Error: Please specify a config name to preview${NC}"
            echo "Usage: $0 --preview [config_name]"
        fi
        ;;
    -h|--help)
        echo "Waybar Config Switcher"
        echo ""
        echo "Usage: $0 [option] [config_name]"
        echo ""
        echo "Options:"
        echo "  -l, --list           List all available configs"
        echo "  -c, --current        Show current active config"
        echo "  -d, --default        Apply default config ($DEFAULT_CONFIG)"
        echo "  -p, --preview        Preview a config layout"
        echo "  -h, --help           Show this help message"
        echo "  [config_name]        Apply specific config by name"
        echo ""
        echo "Examples:"
        echo "  $0                     Interactive menu"
        echo "  $0 window middle       Apply 'window middle' config"
        echo "  $0 -d                  Apply default config"
        echo "  $0 -l                  List all configs"
        echo "  $0 -p taskbar          Preview 'taskbar' config"
        ;;
    "")
        # No arguments - show interactive menu
        interactive_menu
        ;;
    *)
        # Apply config by name
        apply_config "$1"
        ;;
esac
