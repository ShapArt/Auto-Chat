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
FIXTURE_SELECTOR = "#autochat-firefox-smoke-fixture"
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


def control_first_line(driver: webdriver.Firefox) -> str:
    controls = driver.find_elements(By.CSS_SELECTOR, CONTROL_SELECTOR)
    if len(controls) != 1:
        return ""
    text = controls[0].text or ""
    return text.splitlines()[0].strip() if text else ""


def wait_control_state(driver: webdriver.Firefox, expected: str, timeout: float = 8) -> None:
    try:
        WebDriverWait(driver, timeout).until(lambda current: control_first_line(current) == expected)
    except TimeoutException as exc:
        actual = control_first_line(driver)
        raise AssertionError(f"control state mismatch: expected={expected!r} actual={actual!r}") from exc


def click_auto(driver: webdriver.Firefox) -> None:
    control = driver.find_element(By.CSS_SELECTOR, CONTROL_SELECTOR)
    for button in control.find_elements(By.CSS_SELECTOR, "button"):
        if (button.text or "").strip().startswith("AUTO"):
            button.click()
            return
    raise AssertionError("AUTO toggle button not found")


def open_fresh_target(driver: webdriver.Firefox, label: str) -> None:
    navigate(driver, TARGET_URL, label)
    try:
        WebDriverWait(driver, 20).until(
            lambda current: len(current.find_elements(By.CSS_SELECTOR, CONTROL_SELECTOR)) == 1
        )
    except TimeoutException as exc:
        raise AssertionError(
            f"Auto-Chat control did not mount on {label}; count={len(driver.find_elements(By.CSS_SELECTOR, CONTROL_SELECTOR))}"
        ) from exc
    wait_control_state(driver, EXPECTED_CONTROL_FIRST_LINE)


def install_synthetic_chatgpt_fixture(driver: webdriver.Firefox, send_delay_ms: int = 350) -> None:
    driver.execute_script(
        """
        const existing = document.querySelector('#autochat-firefox-smoke-fixture');
        if (existing) existing.remove();

        // Hide live ChatGPT structural controls so this behavior smoke is driven only
        // by the synthetic visible-DOM fixture below. The userscript itself remains
        // installed and running on the real chatgpt.com origin through Tampermonkey.
        for (const el of document.querySelectorAll(
          '#prompt-textarea, #composer-submit-button, button[data-testid="send-button"], button[data-testid="stop-button"], [data-message-author-role="assistant"][aria-busy="true"]'
        )) {
          el.setAttribute('aria-hidden', 'true');
        }

        const fixture = document.createElement('section');
        fixture.id = 'autochat-firefox-smoke-fixture';
        fixture.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2147483000;background:white;color:black;padding:8px;';

        const turns = document.createElement('div');
        turns.id = 'smoke-turns';

        const composer = document.createElement('div');
        composer.id = 'prompt-textarea';
        composer.contentEditable = 'true';
        composer.setAttribute('role', 'textbox');
        composer.style.cssText = 'display:block;visibility:visible;min-width:220px;min-height:24px;border:1px solid black;';

        fixture.append(turns, composer);
        const root = document.querySelector('#chatgpt-autopilot-control');
        document.body.insertBefore(fixture, root ? root.nextSibling : document.body.firstChild);

        window.__autochatSmoke = {
          inputEvents: 0,
          sendClicks: 0,
          sendMounts: 0,
          sendScheduled: false,
          sendDelayMs: arguments[0],
        };

        composer.addEventListener('input', () => {
          window.__autochatSmoke.inputEvents += 1;
          const text = (composer.textContent || '').trim();
          if (!text || window.__autochatSmoke.sendScheduled) return;
          window.__autochatSmoke.sendScheduled = true;
          setTimeout(() => {
            if (!document.querySelector('#autochat-firefox-smoke-fixture')) return;
            const send = document.createElement('button');
            send.type = 'button';
            send.dataset.testid = 'send-button';
            send.textContent = 'Send';
            send.addEventListener('click', () => {
              window.__autochatSmoke.sendClicks += 1;
            });
            fixture.append(send);
            window.__autochatSmoke.sendMounts += 1;
          }, window.__autochatSmoke.sendDelayMs);
        });
        """,
        send_delay_ms,
    )
    WebDriverWait(driver, 5).until(
        lambda current: len(current.find_elements(By.CSS_SELECTOR, FIXTURE_SELECTOR)) == 1
    )


def smoke_stats(driver: webdriver.Firefox) -> dict:
    return driver.execute_script("return {...window.__autochatSmoke};")


def set_manual_composer(driver: webdriver.Firefox, text: str) -> None:
    driver.execute_script(
        """
        const composer = document.querySelector('#autochat-firefox-smoke-fixture #prompt-textarea');
        composer.textContent = arguments[0];
        composer.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'insertText', data: arguments[0]}));
        """,
        text,
    )


def start_generation(driver: webdriver.Firefox) -> None:
    driver.execute_script(
        """
        const fixture = document.querySelector('#autochat-firefox-smoke-fixture');
        const turns = fixture.querySelector('#smoke-turns');
        let assistant = fixture.querySelector('[data-message-author-role="assistant"]');
        if (!assistant) {
          assistant = document.createElement('div');
          assistant.dataset.messageAuthorRole = 'assistant';
          turns.append(assistant);
        }
        assistant.setAttribute('aria-busy', 'true');
        let stop = fixture.querySelector('[data-testid="stop-button"]');
        if (!stop) {
          stop = document.createElement('button');
          stop.dataset.testid = 'stop-button';
          stop.textContent = 'Stop';
          fixture.append(stop);
        }
        """
    )


def finish_generation(driver: webdriver.Firefox) -> None:
    driver.execute_script(
        """
        const fixture = document.querySelector('#autochat-firefox-smoke-fixture');
        fixture.querySelector('[data-testid="stop-button"]')?.remove();
        const assistant = fixture.querySelector('[data-message-author-role="assistant"]');
        if (assistant) assistant.setAttribute('aria-busy', 'false');
        """
    )


def scenario_idle_enable(driver: webdriver.Firefox) -> None:
    log("scenario: idle enable must arm without submitting")
    open_fresh_target(driver, "idle scenario target")
    install_synthetic_chatgpt_fixture(driver)
    click_auto(driver)
    wait_control_state(driver, "AUTO · armed")
    time.sleep(0.7)
    stats = smoke_stats(driver)
    if stats["inputEvents"] != 0 or stats["sendClicks"] != 0:
        raise AssertionError(f"idle enable mutated/submitted unexpectedly: {stats}")
    log(f"idle scenario PASS: {stats}")


def scenario_one_turn_delayed_send(driver: webdriver.Firefox) -> None:
    log("scenario: one generation -> delayed Send -> exactly one submission")
    open_fresh_target(driver, "one-turn scenario target")
    install_synthetic_chatgpt_fixture(driver, send_delay_ms=350)
    click_auto(driver)
    wait_control_state(driver, "AUTO · armed")
    start_generation(driver)
    wait_control_state(driver, "AUTO · generating")
    finish_generation(driver)

    WebDriverWait(driver, 8).until(lambda current: smoke_stats(current)["sendClicks"] == 1)
    time.sleep(0.7)
    stats = smoke_stats(driver)
    if stats["inputEvents"] != 1 or stats["sendMounts"] != 1 or stats["sendClicks"] != 1:
        raise AssertionError(f"one-turn exactly-once contract failed: {stats}")
    log(f"one-turn scenario PASS: {stats}; state={control_first_line(driver)!r}")


def scenario_manual_draft(driver: webdriver.Firefox) -> None:
    log("scenario: manual draft must pause and remain unsent")
    open_fresh_target(driver, "manual-draft scenario target")
    install_synthetic_chatgpt_fixture(driver)
    set_manual_composer(driver, "manual draft")
    click_auto(driver)
    wait_control_state(driver, "AUTO · armed")
    start_generation(driver)
    wait_control_state(driver, "AUTO · generating")
    finish_generation(driver)
    wait_control_state(driver, "AUTO · paused", timeout=8)
    time.sleep(0.5)
    stats = smoke_stats(driver)
    composer_text = driver.execute_script(
        "return document.querySelector('#autochat-firefox-smoke-fixture #prompt-textarea').textContent;"
    )
    if stats["sendClicks"] != 0 or composer_text != "manual draft":
        raise AssertionError(f"manual draft guard failed: stats={stats} composer={composer_text!r}")
    log(f"manual-draft scenario PASS: {stats}")


def scenario_pending_manual_edit(driver: webdriver.Firefox) -> None:
    log("scenario: edit pending continuation before delayed Send -> pause, no submit")
    open_fresh_target(driver, "pending-edit scenario target")
    install_synthetic_chatgpt_fixture(driver, send_delay_ms=1200)
    click_auto(driver)
    wait_control_state(driver, "AUTO · armed")
    start_generation(driver)
    wait_control_state(driver, "AUTO · generating")
    finish_generation(driver)

    WebDriverWait(driver, 6).until(
        lambda current: bool(
            current.execute_script(
                "return (document.querySelector('#autochat-firefox-smoke-fixture #prompt-textarea').textContent || '').trim();"
            )
        )
    )
    driver.execute_script(
        """
        const composer = document.querySelector('#autochat-firefox-smoke-fixture #prompt-textarea');
        composer.textContent = (composer.textContent || '') + ' MANUAL-EDIT';
        composer.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'insertText', data: ' MANUAL-EDIT'}));
        """
    )
    wait_control_state(driver, "AUTO · paused", timeout=4)
    time.sleep(1.4)
    stats = smoke_stats(driver)
    if stats["sendClicks"] != 0:
        raise AssertionError(f"pending manual edit was submitted: {stats}")
    log(f"pending-edit scenario PASS: {stats}")


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

        open_fresh_target(driver, "initial chatgpt mount")
        controls = driver.find_elements(By.CSS_SELECTOR, CONTROL_SELECTOR)
        log(f"Control count: {len(controls)}")
        log(f"Control text: {controls[0].text!r}")

        scenario_idle_enable(driver)
        scenario_one_turn_delayed_send(driver)
        scenario_manual_draft(driver)
        scenario_pending_manual_edit(driver)

        log(
            "PASS: Tampermonkey installed the current build and Auto-Chat passed mount + browser-level behavior smoke in Firefox."
        )
        return 0
    finally:
        log("quitting Firefox")
        driver.quit()


if __name__ == "__main__":
    raise SystemExit(main())
