from __future__ import annotations

import os
import sys
import time
from pathlib import Path

from selenium import webdriver
from selenium.common.exceptions import TimeoutException
from selenium.webdriver.common.by import By
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.support.ui import WebDriverWait

TAMPERMONKEY_XPI = Path(os.environ.get("TAMPERMONKEY_XPI", "tampermonkey.xpi")).resolve()
USERSCRIPT_URL = os.environ.get(
    "USERSCRIPT_URL",
    "https://raw.githubusercontent.com/ShapArt/Auto-Chat/rc/v0.1.0-rc2/chatgpt-autopilot.user.js",
)
TARGET_URL = os.environ.get("TARGET_URL", "https://chatgpt.com/")
CONTROL_SELECTOR = "#chatgpt-autopilot-control"


def describe_windows(driver: webdriver.Firefox) -> None:
    print("\n== Firefox windows ==")
    for index, handle in enumerate(driver.window_handles):
        driver.switch_to.window(handle)
        try:
            print(index, handle, repr(driver.title), driver.current_url)
        except Exception as exc:  # diagnostic only
            print(index, handle, "<unreadable>", repr(exc))


def find_install_button(driver: webdriver.Firefox):
    candidates = driver.find_elements(
        By.CSS_SELECTOR,
        "button, input[type='button'], input[type='submit'], [role='button']",
    )
    labels: list[str] = []
    for candidate in candidates:
        text = (
            candidate.text
            or candidate.get_attribute("value")
            or candidate.get_attribute("aria-label")
            or candidate.get_attribute("title")
            or ""
        ).strip()
        if text:
            labels.append(text)
        normalized = text.casefold()
        if normalized == "install" or normalized.startswith("install "):
            return candidate, labels
    return None, labels


def main() -> int:
    if not TAMPERMONKEY_XPI.is_file():
        print(f"Tampermonkey XPI missing: {TAMPERMONKEY_XPI}", file=sys.stderr)
        return 2

    options = Options()
    options.add_argument("--headless")
    options.set_preference("browser.shell.checkDefaultBrowser", False)
    options.set_preference("browser.startup.page", 0)
    options.set_preference("browser.tabs.warnOnClose", False)
    options.set_preference("browser.tabs.warnOnOpen", False)
    options.set_preference("extensions.autoDisableScopes", 0)
    options.set_preference("extensions.enabledScopes", 15)

    driver = webdriver.Firefox(options=options)
    try:
        print("Firefox:", driver.capabilities.get("browserVersion"))
        print("Geckodriver:", driver.capabilities.get("moz:geckodriverVersion"))

        addon_id = driver.install_addon(str(TAMPERMONKEY_XPI), temporary=True)
        print("Tampermonkey addon installed:", addon_id)
        time.sleep(3)
        describe_windows(driver)

        # Keep one deterministic tab and avoid letting an onboarding tab become the test target.
        primary = driver.window_handles[0]
        for handle in driver.window_handles[1:]:
            driver.switch_to.window(handle)
            driver.close()
        driver.switch_to.window(primary)

        print("\nOpening userscript URL:", USERSCRIPT_URL)
        driver.get(USERSCRIPT_URL)
        time.sleep(5)
        describe_windows(driver)

        install_clicked = False
        all_labels: list[str] = []
        for handle in list(driver.window_handles):
            driver.switch_to.window(handle)
            button, labels = find_install_button(driver)
            all_labels.extend(labels)
            if button is None:
                continue
            print("Install candidate on:", driver.current_url)
            print("Install button label:", repr(button.text or button.get_attribute("value")))
            button.click()
            install_clicked = True
            break

        if not install_clicked:
            print("No Install button found. Visible button labels:", all_labels)
            describe_windows(driver)
            return 10

        time.sleep(3)
        describe_windows(driver)

        # Use whichever tab survived the installation flow.
        if not driver.window_handles:
            print("All windows closed after userscript installation", file=sys.stderr)
            return 11
        driver.switch_to.window(driver.window_handles[0])

        print("\nOpening target:", TARGET_URL)
        driver.get(TARGET_URL)
        try:
            WebDriverWait(driver, 20).until(
                lambda current: len(current.find_elements(By.CSS_SELECTOR, CONTROL_SELECTOR)) == 1
            )
        except TimeoutException:
            print("Auto-Chat control did not mount")
            print("Title:", repr(driver.title))
            print("URL:", driver.current_url)
            print("Control count:", len(driver.find_elements(By.CSS_SELECTOR, CONTROL_SELECTOR)))
            return 20

        controls = driver.find_elements(By.CSS_SELECTOR, CONTROL_SELECTOR)
        print("Control count:", len(controls))
        print("Control text:", repr(controls[0].text))
        if len(controls) != 1:
            return 21
        if "AUTO" not in controls[0].text:
            return 22

        print("SPIKE PASS: Tampermonkey installed the userscript and Auto-Chat mounted once in Firefox.")
        return 0
    finally:
        driver.quit()


if __name__ == "__main__":
    raise SystemExit(main())
