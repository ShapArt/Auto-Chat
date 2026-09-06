from __future__ import annotations

import time

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.support.ui import WebDriverWait

import firefox_tampermonkey_smoke as base


def add_system_alert(driver: webdriver.Firefox, text: str) -> None:
    driver.execute_script(
        """
        const fixture = document.querySelector('#autochat-firefox-smoke-fixture');
        const alert = document.createElement('div');
        alert.setAttribute('role', 'alert');
        alert.textContent = arguments[0];
        fixture.append(alert);
        """,
        text,
    )


def scenario_usage_limit_pauses(driver: webdriver.Firefox) -> None:
    base.log("scenario: usage-limit surface must pause without retry/submission")
    base.open_fresh_target(driver, "usage-limit scenario target")
    base.install_synthetic_chatgpt_fixture(driver)
    base.click_auto(driver)
    base.wait_control_state(driver, "AUTO · armed")

    add_system_alert(driver, "You've reached your usage limit")
    base.wait_control_state(driver, "AUTO · paused", timeout=4)
    time.sleep(0.5)

    stats = base.smoke_stats(driver)
    if stats["inputEvents"] != 0 or stats["sendClicks"] != 0:
        raise AssertionError(f"usage-limit restriction was mutated/retried: {stats}")
    base.log(f"usage-limit scenario PASS: {stats}")


def scenario_conversation_limit_outside_project(driver: webdriver.Firefox) -> None:
    base.log("scenario: conversation limit outside Project must fail closed without global New chat")
    base.open_fresh_target(driver, "conversation-limit scenario target")
    base.install_synthetic_chatgpt_fixture(driver)
    base.click_auto(driver)
    base.wait_control_state(driver, "AUTO · armed")

    before_url = driver.current_url
    add_system_alert(driver, "Maximum length for this conversation")
    base.wait_control_state(driver, "AUTO · paused", timeout=4)
    time.sleep(0.5)

    stats = base.smoke_stats(driver)
    after_url = driver.current_url
    if stats["inputEvents"] != 0 or stats["sendClicks"] != 0:
        raise AssertionError(f"conversation-limit fail-closed contract mutated/submitted: {stats}")
    if after_url != before_url:
        raise AssertionError(
            f"conversation-limit outside Project navigated unexpectedly: before={before_url!r} after={after_url!r}"
        )
    base.log(f"conversation-limit scenario PASS: url={after_url!r} stats={stats}")


def main() -> int:
    if not base.TAMPERMONKEY_XPI.is_file():
        base.log(f"Tampermonkey XPI missing: {base.TAMPERMONKEY_XPI}")
        return 2

    options = Options()
    options.add_argument("--headless")
    options.set_preference("browser.shell.checkDefaultBrowser", False)
    options.set_preference("browser.startup.page", 0)
    options.set_preference("browser.tabs.warnOnClose", False)
    options.set_preference("browser.tabs.warnOnOpen", False)
    options.set_preference("extensions.autoDisableScopes", 0)
    options.set_preference("extensions.enabledScopes", 15)

    base.log("starting Firefox for restriction smoke")
    driver = webdriver.Firefox(options=options)
    driver.set_page_load_timeout(base.PAGE_LOAD_TIMEOUT_SECONDS)
    try:
        base.log(f"Firefox: {driver.capabilities.get('browserVersion')}")
        base.log(f"Geckodriver: {driver.capabilities.get('moz:geckodriverVersion')}")

        base.log("installing Tampermonkey XPI")
        addon_id = driver.install_addon(str(base.TAMPERMONKEY_XPI), temporary=True)
        base.log(f"Tampermonkey addon installed: {addon_id}")
        time.sleep(3)
        base.describe_windows(driver)

        primary = driver.window_handles[0]
        for handle in driver.window_handles[1:]:
            driver.switch_to.window(handle)
            driver.close()
        driver.switch_to.window(primary)

        base.navigate(driver, base.USERSCRIPT_URL, "restriction userscript URL")
        time.sleep(5)
        base.describe_windows(driver)

        install_clicked = False
        all_labels: list[str] = []
        for handle in list(driver.window_handles):
            driver.switch_to.window(handle)
            button, labels = base.find_install_button(driver)
            all_labels.extend(labels)
            if button is None:
                continue
            base.log(f"Install candidate on: {driver.current_url}")
            button.click()
            install_clicked = True
            break

        if not install_clicked:
            base.log(f"No Install button found. Visible button labels: {all_labels}")
            base.describe_windows(driver)
            return 10

        time.sleep(3)
        if not driver.window_handles:
            base.log("All windows closed after userscript installation")
            return 11
        driver.switch_to.window(driver.window_handles[0])

        base.open_fresh_target(driver, "restriction initial chatgpt mount")
        controls = driver.find_elements(By.CSS_SELECTOR, base.CONTROL_SELECTOR)
        if len(controls) != 1:
            raise AssertionError(f"expected one Auto-Chat control, got {len(controls)}")

        scenario_usage_limit_pauses(driver)
        scenario_conversation_limit_outside_project(driver)

        base.log("PASS: Auto-Chat failed closed for terminal restriction and non-Project conversation limit.")
        return 0
    finally:
        base.log("quitting restriction Firefox")
        driver.quit()


if __name__ == "__main__":
    raise SystemExit(main())
