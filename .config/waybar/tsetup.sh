#!/bin/bash
# Waybar Setup Script
# Initial setup script to configure Waybar with default settings
# Uses "window middle" as the primary config
# Creates symlinks for config and style files

IFS=$'\n\t'

# Define directories
WAYBAR_DIR="$HOME/.config/waybar"
WAYBAR_CONFIGS="$WAYBAR_DIR/configs"
WAYBAR_STYLES="$WAYBAR_DIR/style"
WAYBAR_CONFIG_LINK="$WAYBAR_DIR/config"
WAYBAR_STYLE_LINK="$WAYBAR_DIR/style.css"
SCRIPTSDIR="$HOME/.config/hypr/scripts"

# Default settings
DEFAULT_CONFIG="window middle"
DEFAULT_STYLE="islands"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Function to print header
print_header() {
    clear
    echo -e "${CYAN}╔═══════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║${NC}                                                       ${CYAN}║${NC}"
    echo -e "${CYAN}║${NC}        ${GREEN}Waybar Configuration Setup${NC}                ${CYAN}║${NC}"
    echo -e "${CYAN}║${NC}        ${BLUE}arch-hyprland waybar manager${NC}              ${CYAN}║${NC}"
    echo -e "${CYAN}║${NC}                                                       ${CYAN}║${NC}"
    echo -e "${CYAN}╚═══════════════════════════════════════════════════════╝${NC}"
    echo ""
}

# Function to check if directories exist
check_directories() {
    echo -e "${BLUE}Checking directories...${NC}"
    
    if [ ! -d "$WAYBAR_CONFIGS" ]; then
        echo -e "${RED}✗ Configs directory not found: $WAYBAR_CONFIGS${NC}"
        return 1
    else
        echo -e "${GREEN}✓ Configs directory found${NC}"
    fi
    
    if [ ! -d "$WAYBAR_STYLES" ]; then
        echo -e "${RED}✗ Styles directory not found: $WAYBAR_STYLES${NC}"
        return 1
    else
        echo -e "${GREEN}✓ Styles directory found${NC}"
    fi
    
    echo ""
    return 0
}

# Function to check if default config exists
check_default_config() {
    if [ ! -f "$WAYBAR_CONFIGS/$DEFAULT_CONFIG" ]; then
        echo -e "${RED}✗ Default config not found: $DEFAULT_CONFIG${NC}"
        echo -e "${YELLOW}Available configs:${NC}"
        ls -1 "$WAYBAR_CONFIGS" | sed 's/^/  - /'
        return 1
    else
        echo -e "${GREEN}✓ Default config found: $DEFAULT_CONFIG${NC}"
        return 0
    fi
}

# Function to check if default style exists
check_default_style() {
    if [ ! -f "$WAYBAR_STYLES/$DEFAULT_STYLE.css" ]; then
        echo -e "${YELLOW}⚠ Default style not found: $DEFAULT_STYLE.css${NC}"
        echo -e "${YELLOW}Available styles:${NC}"
        ls -1 "$WAYBAR_STYLES"/*.css | xargs -n1 basename | sed 's/.css$//' | sed 's/^/  - /'
        echo ""
        echo -e "${BLUE}Please choose a style:${NC}"
        
        # Let user select from available styles
        local styles=($(ls -1 "$WAYBAR_STYLES"/*.css | xargs -n1 basename | sed 's/.css$//'))
        local index=1
        for style in "${styles[@]}"; do
            echo -e "  ${YELLOW}[$index]${NC} $style"
            index=$((index + 1))
        done
        
        echo ""
        echo -e "${BLUE}Enter number or style name:${NC} "
        read -r choice
        
        if [[ "$choice" =~ ^[0-9]+$ ]]; then
            DEFAULT_STYLE="${styles[$((choice - 1))]}"
        else
            DEFAULT_STYLE="$choice"
        fi
        
        if [ ! -f "$WAYBAR_STYLES/$DEFAULT_STYLE.css" ]; then
            echo -e "${RED}✗ Invalid style selection${NC}"
            return 1
        fi
    fi
    
    echo -e "${GREEN}✓ Style selected: $DEFAULT_STYLE.css${NC}"
    return 0
}

# Function to backup existing symlinks
backup_symlinks() {
    local backed_up=false
    
    if [ -L "$WAYBAR_CONFIG_LINK" ] || [ -f "$WAYBAR_CONFIG_LINK" ]; then
        local backup_name="config.backup.$(date +%Y%m%d_%H%M%S)"
        mv "$WAYBAR_CONFIG_LINK" "$WAYBAR_DIR/$backup_name"
        echo -e "${YELLOW}⚠ Backed up existing config to: $backup_name${NC}"
        backed_up=true
    fi
    
    if [ -L "$WAYBAR_STYLE_LINK" ] || [ -f "$WAYBAR_STYLE_LINK" ]; then
        local backup_name="style.css.backup.$(date +%Y%m%d_%H%M%S)"
        mv "$WAYBAR_STYLE_LINK" "$WAYBAR_DIR/$backup_name"
        echo -e "${YELLOW}⚠ Backed up existing style to: $backup_name${NC}"
        backed_up=true
    fi
    
    if [ "$backed_up" = true ]; then
        echo ""
    fi
}

# Function to create symlinks
create_symlinks() {
    echo -e "${BLUE}Creating symlinks...${NC}"
    
    # Create config symlink
    ln -sf "$WAYBAR_CONFIGS/$DEFAULT_CONFIG" "$WAYBAR_CONFIG_LINK"
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ Config symlink created:${NC}"
        echo -e "  config → configs/$DEFAULT_CONFIG"
    else
        echo -e "${RED}✗ Failed to create config symlink${NC}"
        return 1
    fi
    
    # Create style symlink
    ln -sf "$WAYBAR_STYLES/$DEFAULT_STYLE.css" "$WAYBAR_STYLE_LINK"
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ Style symlink created:${NC}"
        echo -e "  style.css → style/$DEFAULT_STYLE.css"
    else
        echo -e "${RED}✗ Failed to create style symlink${NC}"
        return 1
    fi
    
    echo ""
    return 0
}

# Function to make scripts executable
make_scripts_executable() {
    echo -e "${BLUE}Setting up management scripts...${NC}"
    
    local scripts=("tstyle.sh" "tconfig.sh" "tsetup.sh")
    
    for script in "${scripts[@]}"; do
        local script_path="$WAYBAR_DIR/$script"
        if [ -f "$script_path" ]; then
            chmod +x "$script_path"
            echo -e "${GREEN}✓ Made executable: $script${NC}"
        fi
    done
    
    echo ""
}

# Function to restart waybar
restart_waybar() {
    echo -e "${BLUE}Restarting Waybar...${NC}"
    
    if [ -f "$SCRIPTSDIR/wbrestart.sh" ]; then
        "$SCRIPTSDIR/wbrestart.sh" &
        sleep 1
        echo -e "${GREEN}✓ Waybar restarted successfully${NC}"
    else
        killall -9 waybar 2>/dev/null
        waybar &
        sleep 1
        echo -e "${GREEN}✓ Waybar restarted${NC}"
    fi
    
    echo ""
}

# Function to show summary
show_summary() {
    echo -e "${CYAN}╔═══════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║${NC}                  ${GREEN}Setup Complete!${NC}                      ${CYAN}║${NC}"
    echo -e "${CYAN}╚═══════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${BLUE}Configuration:${NC}"
    echo -e "  ${YELLOW}Config:${NC}  $DEFAULT_CONFIG"
    echo -e "  ${YELLOW}Style:${NC}   $DEFAULT_STYLE"
    echo ""
    echo -e "${BLUE}Management Scripts:${NC}"
    echo -e "  ${YELLOW}~/.config/waybar/tstyle.sh${NC}   - Switch Waybar styles"
    echo -e "  ${YELLOW}~/.config/waybar/tconfig.sh${NC}  - Switch Waybar configs"
    echo -e "  ${YELLOW}~/.config/waybar/tsetup.sh${NC}   - Re-run this setup"
    echo ""
    echo -e "${BLUE}Quick Commands:${NC}"
    echo -e "  ${GREEN}tstyle${NC}       - Interactive style switcher"
    echo -e "  ${GREEN}tstyle -l${NC}    - List all styles"
    echo -e "  ${GREEN}tconfig${NC}      - Interactive config switcher"
    echo -e "  ${GREEN}tconfig -l${NC}   - List all configs"
    echo -e "  ${GREEN}tconfig -d${NC}   - Reset to default config"
    echo ""
    echo -e "${YELLOW}Tip:${NC} Add aliases to your shell RC file for easier access:"
    echo -e "  ${CYAN}alias tstyle='~/.config/waybar/tstyle.sh'${NC}"
    echo -e "  ${CYAN}alias tconfig='~/.config/waybar/tconfig.sh'${NC}"
    echo ""
}

# Main setup function
main() {
    print_header
    
    echo -e "${BLUE}Starting Waybar setup...${NC}"
    echo ""
    
    # Check directories
    if ! check_directories; then
        echo -e "${RED}Setup failed: Required directories not found${NC}"
        exit 1
    fi
    
    # Check default config
    echo -e "${BLUE}Checking default configuration...${NC}"
    if ! check_default_config; then
        echo -e "${RED}Setup failed: Default config not found${NC}"
        exit 1
    fi
    echo ""
    
    # Check and select style
    echo -e "${BLUE}Checking style configuration...${NC}"
    if ! check_default_style; then
        echo -e "${RED}Setup failed: Style configuration error${NC}"
        exit 1
    fi
    echo ""
    
    # Backup existing symlinks
    echo -e "${BLUE}Checking for existing configuration...${NC}"
    backup_symlinks
    
    # Create symlinks
    if ! create_symlinks; then
        echo -e "${RED}Setup failed: Could not create symlinks${NC}"
        exit 1
    fi
    
    # Make scripts executable
    make_scripts_executable
    
    # Restart waybar
    restart_waybar
    
    # Show summary
    show_summary
}

# Parse command line arguments
case "${1:-}" in
    -h|--help)
        echo "Waybar Setup Script"
        echo ""
        echo "This script sets up Waybar configuration with default settings:"
        echo "  - Default config: $DEFAULT_CONFIG"
        echo "  - Default style: $DEFAULT_STYLE"
        echo ""
        echo "Usage: $0 [option]"
        echo ""
        echo "Options:"
        echo "  -h, --help     Show this help message"
        echo "  -r, --reset    Reset to default configuration"
        echo ""
        echo "The script will:"
        echo "  1. Check for required directories"
        echo "  2. Backup existing configuration"
        echo "  3. Create symlinks to default config and style"
        echo "  4. Make management scripts executable"
        echo "  5. Restart Waybar"
        ;;
    -r|--reset)
        print_header
        echo -e "${YELLOW}Resetting to default configuration...${NC}"
        echo ""
        main
        ;;
    *)
        main
        ;;
esac
