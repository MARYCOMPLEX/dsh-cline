"""Open the isolated DSH web profile, reach Settings -> Models, and verify the
dsh-cline footer panel renders and its controls talk to the Host routes."""

import json
import sys

from playwright.sync_api import sync_playwright

URL = sys.argv[1]
SHOT = sys.argv[2] if len(sys.argv) > 2 else "panel.png"

console = []
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1500, "height": 1200})
    page.on("console", lambda message: console.append(f"{message.type}: {message.text}"))
    page.on("pageerror", lambda error: console.append(f"pageerror: {error}"))

    page.goto(URL, wait_until="networkidle", timeout=120000)
    page.wait_for_timeout(2500)

    # Open Settings from the sidebar or the account menu.
    opened = False
    for selector in ["text=Settings", "text=设置", "[aria-label*='Settings']", "[data-testid*='settings']"]:
        try:
            target = page.locator(selector).first
            if target.count() and target.is_visible():
                target.click(timeout=5000)
                opened = True
                break
        except Exception:
            continue
    page.wait_for_timeout(1200)

    models = False
    for selector in ["text=Models", "text=模型"]:
        try:
            target = page.locator(selector).first
            if target.count() and target.is_visible():
                target.click(timeout=5000)
                models = True
                break
        except Exception:
            continue
    page.wait_for_timeout(3500)

    body = page.inner_text("body")
    has_title = ("Cline 上游" in body) or ("Cline Upstreams" in body)
    has_gateway = "api.cline.bot" in body

    page.screenshot(path=SHOT, full_page=True)

    # Exercise the probe button if the panel rendered.
    probed = None
    if has_title:
        buttons = page.locator("button", has_text="探测")
        if buttons.count() == 0:
            buttons = page.locator("button", has_text="Probe")
        if buttons.count():
            buttons.first.click()
            page.wait_for_timeout(12000)
            probed = "clicked"
            page.screenshot(path=SHOT.replace(".png", "-probed.png"), full_page=True)
            body = page.inner_text("body")

    print(json.dumps({
        "settingsOpened": opened,
        "modelsOpened": models,
        "panelTitle": has_title,
        "gatewayShown": has_gateway,
        "probe": probed,
        "bodyHasPlanner": "planner" in body,
        "snippet": body[:1200],
    }, ensure_ascii=False, indent=2))

    errors = [line for line in console if line.startswith("error") or line.startswith("pageerror")]
    print("CONSOLE_ERRORS:", json.dumps(errors[:20], ensure_ascii=False))
    browser.close()