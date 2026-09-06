from __future__ import annotations

import os
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
    "http://127.0.0.1:8765/chatgpt-autopilot.user.js",
)
TARGET_URL = os.environ.get("TARGET_URL", "https://chatgpt.com/")
CONTROL_SELECTOR = "#chatgpt-autopilot-control"
EXPECTED_CONTROL_FIRST_LINE = "AUTO · off"
PAGE_LOAD_TIMEOUT_SECONDS = 15


def log(message: str) -> None:
    print(f"[{time.monotonic():.3f}] {message}", flush=True)


def navigate(driver: webdriver.Firefox, url: str, label: str) -> None:
    log(f"navigate start: {label}: {url}")
    started = time.monotonic()
    try:
        driver.get(url)
        log(f"navigate complete: {label}: {time.monotonic() - started:.2f}s")
    except TimeoutException:
        # Tampermonkey intercepts a .user.js navigation and opens its own
        # moz-extension:// installation tab. The originating request may
        # therefore never report a normal page-load completion to WebDriver.
        log(f"navigate TIMEOUT after {time.monotonic() - started:.2f}s: {label}")
        try:
            driver.execute_script("window.stop();")
        except Exception as exc:  # diagnostic only
            log(f"window.stop failed: {exc!r}")


def describe_windows(driver: webdriver.Firefox) -> None:
    log("== Firefox windows ==")
    for index, handle in enumerate(driver.window_handles):
        driver.switch_to.window(handle)
        try:
            log(f"window {index}: {handle} title={driver.title!r} url={driver.current_url}")
        except Exception as exc:  # diagnostic only
            log(f"window {index}: {handle} <unreadable> {exc!r}")


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
        log(f"Tampermonkey XPI missing: {TAMPERMONKEY_XPI}")
        return 2

    options = Options()
    options.add_argument("--headless")
    options.set_preference("browser.shell.checkDefaultBrowser", False)
    options.set_preference("browser.startup.page", 0)
    options.set_preference("browser.tabs.warnOnClose", False)
    options.set_preference("browser.tabs.warnOnOpen", False)
    options.set_preference("extensions.autoDisableScopes", 0)
    options.set_preference("extensions.enabledScopes", 15)

    log("starting Firefox")
    driver = webdriver.Firefox(options=options)
    driver.set_page_load_timeout(PAGE_LOAD_TIMEOUT_SECONDS)
    try:
        log(f"Firefox: {driver.capabilities.get('browserVersion')}")
        log(f"Geckodriver: {driver.capabilities.get('moz:geckodriverVersion')}")

        log("installing Tampermonkey XPI")
        addon_id = driver.install_addon(str(TAMPERMONKEY_XPI), temporary=True)
        log(f"Tampermonkey addon installed: {addon_id}")
        time.sleep(3)
        describe_windows(driver)

        # Keep one deterministic tab and avoid letting onboarding become the test target.
        primary = driver.window_handles[0]
        for handle in driver.window_handles[1:]:
            driver.switch_to.window(handle)
            driver.close()
        driver.switch_to.window(primary)

        navigate(driver, USERSCRIPT_URL, "userscript URL")
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
            log(f"Install candidate on: {driver.current_url}")
            log(f"Install button label: {(button.text or button.get_attribute('value'))!r}")
            button.click()
            install_clicked = True
            break

        if not install_clicked:
            log(f"No Install button found. Visible button labels: {all_labels}")
            describe_windows(driver)
            return 10

        time.sleep(3)
        describe_windows(driver)

        if not driver.window_handles:
            log("All windows closed after userscript installation")
            return 11
        driver.switch_to.window(driver.window_handles[0])

        navigate(driver, TARGET_URL, "chatgpt target")
        try:
            WebDriverWait(driver, 20).until(
                lambda current: len(current.find_elements(By.CSS_SELECTOR, CONTROL_SELECTOR)) == 1
            )
        except TimeoutException:
            log("Auto-Chat control did not mount")
            log(f"Title: {driver.title!r}")
            log(f"URL: {driver.current_url}")
            log(f"Control count: {len(driver.find_elements(By.CSS_SELECTOR, CONTROL_SELECTOR))}")
            return 20

        controls = driver.find_elements(By.CSS_SELECTOR, CONTROL_SELECTOR)
        log(f"Control count: {len(controls)}")
        log(f"Control text: {controls[0].text!r}")
        if len(controls) != 1:
            return 21

        first_line = controls[0].text.splitlines()[0].strip() if controls[0].text else ""
        if first_line != EXPECTED_CONTROL_FIRST_LINE:
            log(
                f"Unexpected control first line: expected={EXPECTED_CONTROL_FIRST_LINE!r} actual={first_line!r}"
            )
            return 22

        log("PASS: Tampermonkey installed the current build and Auto-Chat mounted once in Firefox.")
        return 0
    finally:
        log("quitting Firefox")
        driver.quit()


if __name__ == "__main__":
    raise SystemExit(main())
