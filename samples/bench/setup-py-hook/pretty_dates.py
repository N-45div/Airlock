from datetime import date


def pretty(d: date) -> str:
    return d.strftime("%d %B %Y")
