"""Farby a štýl grafov analýz klasifikácie (rovnaký vzhľad ako grafy, z ktorých vznikol kľúč)."""
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap

POVRCH, ATRAMENT, ATRAMENT2, TLMENA = "#fcfcfb", "#0b0b0b", "#52514e", "#898781"
MRIEZKA, OS, KONTEXT = "#e1e0d9", "#c3c2b7", "#d6d5cf"
MODRA, MODRA_SVETLA, MODRA_TMAVA = "#2a78d6", "#9ec5f4", "#184f95"
TMAVE, SVETLE, CERVENA = "#8a5a2b", "#e3b505", "#d03b3b"
SEKVENCNA = LinearSegmentedColormap.from_list("modra", ["#f0efec", "#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5",
                                                        "#256abf", "#184f95", "#0d366b"])

plt.rcParams.update({
    "figure.facecolor": POVRCH, "axes.facecolor": POVRCH, "savefig.facecolor": POVRCH,
    "font.family": ["Segoe UI", "DejaVu Sans"], "font.size": 9,
    "text.color": ATRAMENT, "axes.titlecolor": ATRAMENT, "axes.labelcolor": ATRAMENT2,
    "axes.edgecolor": OS, "axes.linewidth": 0.8, "axes.spines.top": False, "axes.spines.right": False,
    "xtick.color": TLMENA, "ytick.color": TLMENA, "xtick.labelcolor": ATRAMENT2, "ytick.labelcolor": ATRAMENT2,
    "grid.color": MRIEZKA, "grid.linewidth": 0.6, "savefig.dpi": 200, "savefig.bbox": "tight",
})


def os_grafu(ax, os="x"):
    ax.grid(axis=os)
    ax.set_axisbelow(True)
