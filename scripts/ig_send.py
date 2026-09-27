#!/usr/bin/env python3
"""
Chạm HQ - send one message to the Chạm Instagram group chat as the
cham_summarizer bot (the same signed-in profile the nightly wrap uses).

    python scripts/ig_send.py            send MESSAGE below, once
    python scripts/ig_send.py --check    only look: signed in? already sent?

Sends at most once: if the message's first line is already in the recent
part of the conversation, it does nothing. If the bot is signed out or the
message box can't be found, it stops and says so - it never retries.
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ig_wrap as w  # noqa: E402  (browser(), load_config(), log())

MESSAGE = """🧾 Chạm yesterday (Sat 26 Sep)
• Wilson joined the chat — welcome! Priorities: raise money fast first
• New on Chạm HQ: a Me page with your own jobs, points and what needs you
Full summary on the Updates tab: peterachss.github.io/cham-hq"""

CONVO = """() => {
  const root = document.querySelector('[aria-label^="Messages in conversation"], [aria-label^="Conversation with"]')
            || document.querySelector('div[role="main"]') || document.body;
  const box = root.querySelector('div[role="textbox"][contenteditable="true"]');
  let t = root.innerText || '';
  if (box && box.innerText) t = t.replace(box.innerText, '');   // never count what is still being typed
  return t.slice(-6000);
}"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    cfg = w.load_config()
    mark = MESSAGE.splitlines()[0].strip()
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        ctx = w.browser(p, headless=True)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto(cfg["thread_url"], timeout=90000)
        page.wait_for_timeout(7000)
        if "/accounts/login" in page.url or "/challenge" in page.url:
            w.log("send: the bot is signed out - run ig_wrap.py --login. Nothing sent.")
            ctx.close()
            sys.exit(2)

        if mark in page.evaluate(CONVO):
            w.log("send: that message is already in the chat - not sending it again")
            ctx.close()
            return

        box = page.locator('div[role="textbox"][contenteditable="true"], div[aria-label="Message"][contenteditable="true"]').first
        try:
            box.wait_for(state="visible", timeout=20000)
        except Exception:
            w.log("send: couldn't find the message box (Instagram may have changed). Nothing sent.")
            ctx.close()
            sys.exit(3)

        if args.check:
            w.log("send --check: signed in, message box found, not sent yet")
            ctx.close()
            return

        box.click()
        lines = MESSAGE.split("\n")
        for i, line in enumerate(lines):
            page.keyboard.insert_text(line)
            if i < len(lines) - 1:
                page.keyboard.press("Shift+Enter")          # new line, same message
        page.wait_for_timeout(700)
        page.keyboard.press("Enter")                        # send - once
        page.wait_for_timeout(6000)

        still_typed = (box.inner_text() or "").strip()
        if not still_typed and mark in page.evaluate(CONVO):
            w.log("send: sent to the group chat and confirmed")
        else:
            w.log("send: pressed send but couldn't confirm it arrived - check the chat. Not retrying.")
            ctx.close()
            sys.exit(4)
        ctx.close()


if __name__ == "__main__":
    main()
