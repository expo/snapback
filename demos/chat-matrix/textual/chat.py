# chat-matrix Textual cell: Python's CSS-styled TUI framework, same product as
# every other authoring stack, over the gateway's portable /rpc surface.
#
#   uv run chat.py [--backend sqlite] [--autodemo] [--gateway http://...]
#
# Keys: Enter send · Tab cycles focus · Ctrl-B backend · Ctrl-P model · Ctrl-N new chat · Ctrl-C quit
#
# /// script
# requires-python = ">=3.9"
# dependencies = ["textual>=0.80", "httpx>=0.27"]
# ///
from __future__ import annotations

import argparse
import os
import sys

import httpx
from textual.app import App, ComposeResult
from textual.containers import Horizontal, Vertical, VerticalScroll
from textual.widgets import Footer, Input, Label, ListItem, ListView, Static

BACKENDS = ["snapback", "convex", "supabase", "sqlite"]
DEFAULT_MODEL = "anthropic/claude-haiku-4.5"


def conversation_title(first: str) -> str:
    joined = " ".join(first.split())
    return joined if len(joined) <= 40 else joined[:39] + "…"


class Gateway:
    def __init__(self, origin: str) -> None:
        self.origin = origin
        self.client = httpx.AsyncClient(timeout=20)

    async def rpc(self, backend: str, op: str, args: dict) -> object:
        response = await self.client.post(
            f"{self.origin}/rpc", json={"backend": backend, "op": op, "args": args}
        )
        payload = response.json()
        if not payload.get("ok"):
            raise RuntimeError(payload.get("error") or f"{backend}.{op} failed")
        return payload["value"]

    async def models(self) -> tuple[list, list]:
        response = await self.client.get(f"{self.origin}/models")
        payload = response.json()
        return payload["featured"], [entry["id"] for entry in payload["models"]]


class ChatApp(App):
    TITLE = "ChatMatrix Textual"
    CSS = """
    #chips { height: 1; }
    #chips Label { padding: 0 1; margin-right: 1; color: $text-muted; }
    #chips Label.active { background: $foreground; color: $background; text-style: bold; }
    #meta { height: 1; }
    #model { color: $accent; margin-right: 2; }
    #badge { color: $text-muted; }
    #thread { border: round $primary; height: 1fr; padding: 0 1; }
    .you { color: $secondary; text-style: bold; }
    .ai { }
    #error { color: $error; height: auto; }
    #picker { border: double $accent; height: 14; display: none; }
    #picker.open { display: block; }
    """
    BINDINGS = [
        ("ctrl+b", "cycle_backend", "backend"),
        ("ctrl+p", "toggle_picker", "model"),
        ("ctrl+n", "new_chat", "new chat"),
    ]

    def __init__(self, gateway: Gateway, backend: str, autodemo: bool) -> None:
        super().__init__()
        self.gateway = gateway
        self.backend = backend
        self.model_id = DEFAULT_MODEL
        self.conversation_id: str | None = None
        self.autodemo = autodemo
        self.featured: list[str] = []
        self.all_models: list[str] = []
        self.transcript: list[dict] = []

    def compose(self) -> ComposeResult:
        with Vertical():
            with Horizontal(id="chips"):
                for name in BACKENDS:
                    yield Label(name, id=f"chip-{name}")
            with Horizontal(id="meta"):
                yield Label(self.model_id, id="model")
                yield Label("built with Textual", id="badge")
            yield VerticalScroll(id="thread")
            yield Static("", id="error")
            yield ListView(id="picker")
            yield Input(placeholder="Message…", id="composer")
            yield Footer()

    async def on_mount(self) -> None:
        self.refresh_chips()
        self.query_one("#composer", Input).focus()
        self.set_interval(0.7, self.poll)
        try:
            self.featured, self.all_models = await self.gateway.models()
        except Exception as error:  # noqa: BLE001 — surfaced in the UI
            self.show_error(str(error))
        if self.autodemo:
            self.set_timer(2.0, self.run_autodemo)

    def refresh_chips(self) -> None:
        for name in BACKENDS:
            self.query_one(f"#chip-{name}", Label).set_class(name == self.backend, "active")

    def show_error(self, message: str) -> None:
        self.query_one("#error", Static).update(message)

    async def run_autodemo(self) -> None:
        await self.send(f"Reply with one short sentence praising the {self.backend} backend.")

    async def send(self, content: str) -> None:
        content = content.strip()
        if not content:
            return
        try:
            if self.conversation_id is None:
                self.conversation_id = await self.gateway.rpc(
                    self.backend,
                    "createConversation",
                    {"model": self.model_id, "title": conversation_title(content)},
                )
            await self.gateway.rpc(
                self.backend,
                "sendMessage",
                {"conversationId": self.conversation_id, "content": content},
            )
            self.show_error("")
        except Exception as error:  # noqa: BLE001
            self.show_error(str(error))

    async def poll(self) -> None:
        if self.conversation_id is None:
            return
        try:
            rows = await self.gateway.rpc(
                self.backend, "listMessages", {"conversationId": self.conversation_id}
            )
        except Exception as error:  # noqa: BLE001
            self.show_error(str(error))
            return
        thread = self.query_one("#thread", VerticalScroll)
        await thread.remove_children()
        for row in rows:
            who = "you " if row["role"] == "user" else "ai  "
            content = row["content"] or "…"
            if row["status"] == "streaming":
                content += " ▍"
            static = Static(f"{who}{content}")
            static.add_class("you" if row["role"] == "user" else "ai")
            await thread.mount(static)
        thread.scroll_end(animate=False)
        if self.autodemo and any(
            row["role"] == "assistant" and row["status"] == "complete" for row in rows
        ):
            self.transcript = rows
            self.exit()

    async def on_input_submitted(self, event: Input.Submitted) -> None:
        if event.input.id == "composer":
            event.input.value = ""
            await self.send(event.value)

    def action_cycle_backend(self) -> None:
        self.backend = BACKENDS[(BACKENDS.index(self.backend) + 1) % len(BACKENDS)]
        self.action_new_chat()
        self.refresh_chips()

    def action_new_chat(self) -> None:
        self.conversation_id = None
        self.call_later(self.query_one("#thread", VerticalScroll).remove_children)
        self.show_error("")

    def action_toggle_picker(self) -> None:
        picker = self.query_one("#picker", ListView)
        if picker.has_class("open"):
            picker.remove_class("open")
            self.query_one("#composer", Input).focus()
            return
        rows = self.featured + [m for m in self.all_models if m not in self.featured]
        self.call_later(self._fill_picker, picker, rows[:200])

    async def _fill_picker(self, picker: ListView, rows: list[str]) -> None:
        await picker.clear()
        for model_id in rows:
            star = "★ " if model_id in self.featured else "  "
            await picker.append(ListItem(Label(f"{star}{model_id}"), name=model_id))
        picker.add_class("open")
        picker.focus()

    def on_list_view_selected(self, event: ListView.Selected) -> None:
        if event.item.name:
            self.model_id = event.item.name
            self.query_one("#model", Label).update(self.model_id)
            self.action_new_chat()
        picker = self.query_one("#picker", ListView)
        picker.remove_class("open")
        self.query_one("#composer", Input).focus()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--backend", default=os.environ.get("CHAT_BACKEND", "sqlite"))
    parser.add_argument(
        "--gateway",
        default=os.environ.get("CHAT_GATEWAY_ORIGIN", "http://127.0.0.1:4470"),
    )
    parser.add_argument(
        "--autodemo",
        action="store_true",
        default=os.environ.get("CHAT_AUTODEMO") == "1",
    )
    args = parser.parse_args()
    backend = args.backend if args.backend in BACKENDS else "sqlite"

    app = ChatApp(Gateway(args.gateway), backend, args.autodemo)
    app.run()
    if args.autodemo:
        for row in app.transcript:
            print(f"{row['role']} {row['status']} | {row['content']}")
        if not app.transcript:
            sys.exit(1)


if __name__ == "__main__":
    main()
