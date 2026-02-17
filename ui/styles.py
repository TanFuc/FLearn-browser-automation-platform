"""
UI Styles and Constants.
"""

# Theme
THEME_NAME = "darkly"

# Colors (Bootstyle)
PRIMARY = "primary"
SECONDARY = "secondary"
SUCCESS = "success"
INFO = "info"
WARNING = "warning"
DANGER = "danger"
LIGHT = "light"
DARK = "dark"

# Font Sizes
FONT_H1 = 24
FONT_H2 = 18
FONT_H3 = 14
FONT_NORMAL = 10
FONT_SMALL = 9

# Layout
PADDING_SMALL = 5
PADDING_MEDIUM = 10
PADDING_LARGE = 20

SIDEBAR_WIDTH = 250

# Status Colors (for manual overrides if needed, though bootstyle handles most)
STATUS_COLORS = {
    "IDLE": "secondary",
    "RUNNING": "primary",
    "OK": "success",
    "CHECKPOINT": "warning",
    "ERROR": "danger",
    "PROXY_DEAD": "danger",
}
