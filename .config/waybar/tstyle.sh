#!/bin/bash
# Waybar Style Switcher Script
# Quick style switcher for Waybar using symlinks
# Uses the arch-hyprland waybar configuration structure

IFS=$'\n\t'

# Define directories
WAYBAR_STYLES="$HOME/.config/waybar/style"
WAYBAR_STYLE_LINK="$HOME/.config/waybar/style.css"
SCRIPTSDIR="$HOME/.config/hypr/scripts"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to display available styles
list_styles() {
    echo -e "${BLUE}Available Waybar Styles:${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    local index=1
    while IFS= read -r file; do
        if [ -f "$WAYBAR_STYLES/$file" ]; then
            local style_name=$(basename "$file" .css)
            
            # Check if this is the current style
            if [ -L "$WAYBAR_STYLE_LINK" ]; then
                local current=$(readlink "$WAYBAR_STYLE_LINK")
                if [[ "$current" == *"$file" ]]; then
                    echo -e "  ${GREEN}[$index]${NC} ${GREEN}✓${NC} $style_name ${GREEN}(active)${NC}"
                else
                    echo -e "  ${YELLOW}[$index]${NC}   $style_name"
                fi
            else
                echo -e "  ${YELLOW}[$index]${NC}   $style_name"
            fi
            index=$((index + 1))
        fi
    done < <(find -L "$WAYBAR_STYLES" -maxdepth 1 -type f -name '*.css' -exec basename {} \; | sort)
    
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

# Function to apply selected style
apply_style() {
    local style_name="$1"
    local style_path="$WAYBAR_STYLES/${style_name}.css"
    
    if [ ! -f "$style_path" ]; then
        echo -e "${RED}Error: Style '$style_name' not found!${NC}"
        return 1
    fi
    
    echo -e "${BLUE}Applying style:${NC} $style_name"
    
    # Create symlink
    ln -sf "$style_path" "$WAYBAR_STYLE_LINK"
    
    echo -e "${GREEN}✓${NC} Style symlink created: style.css → style/${style_name}.css"
    
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

# Function to show current style
show_current() {
    if [ -L "$WAYBAR_STYLE_LINK" ]; then
        local current=$(readlink "$WAYBAR_STYLE_LINK")
        local style_name=$(basename "$current" .css)
        echo -e "${BLUE}Current style:${NC} ${GREEN}$style_name${NC}"
    else
        echo -e "${YELLOW}No style symlink found${NC}"
    fi
}

# Main menu function
interactive_menu() {
    clear
    echo -e "${BLUE}╔═══════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║${NC}     ${GREEN}Waybar Style Switcher${NC}             ${BLUE}║${NC}"
    echo -e "${BLUE}╚═══════════════════════════════════════════╝${NC}"
    echo ""
    
    show_current
    echo ""
    list_styles
    echo ""
    echo -e "${BLUE}Enter style number or name (q to quit):${NC} "
    read -r choice
    
    if [[ "$choice" == "q" ]] || [[ "$choice" == "Q" ]]; then
        echo -e "${YELLOW}Exiting...${NC}"
        exit 0
    fi
    
    # Check if input is a number
    if [[ "$choice" =~ ^[0-9]+$ ]]; then
        local index=1
        while IFS= read -r file; do
            if [ -f "$WAYBAR_STYLES/$file" ]; then
                if [ "$index" -eq "$choice" ]; then
                    local style_name=$(basename "$file" .css)
                    apply_style "$style_name"
                    return 0
                fi
                index=$((index + 1))
            fi
        done < <(find -L "$WAYBAR_STYLES" -maxdepth 1 -type f -name '*.css' -exec basename {} \; | sort)
        
        echo -e "${RED}Invalid selection${NC}"
    else
        # Treat as style name
        apply_style "$choice"
    fi
}

# Parse command line arguments
case "${1:-}" in
    -l|--list)
        show_current
        echo ""
        list_styles
        ;;
    -c|--current)
        show_current
        ;;
    -h|--help)
        echo "Waybar Style Switcher"
        echo ""
        echo "Usage: $0 [option] [style_name]"
        echo ""
        echo "Options:"
        echo "  -l, --list           List all available styles"
        echo "  -c, --current        Show current active style"
        echo "  -h, --help           Show this help message"
        echo "  [style_name]         Apply specific style by name"
        echo ""
        echo "Examples:"
        echo "  $0                   Interactive menu"
        echo "  $0 islands           Apply 'islands' style"
        echo "  $0 -l                List all styles"
        ;;
    "")
        # No arguments - show interactive menu
        interactive_menu
        ;;
    *)
        # Apply style by name
        apply_style "$1"
        ;;
esac
