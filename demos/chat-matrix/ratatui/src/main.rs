// chat-matrix Ratatui cell: the same product as every other authoring stack —
// pick an OpenRouter model, talk to it — over the gateway's portable /rpc
// surface. Blocking reqwest on a worker thread feeds a channel; the draw loop
// polls crossterm events at 60ms so streaming updates paint as they land.

use std::io;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use anyhow::Result;
use crossterm::event::{self, Event, KeyCode, KeyEventKind, KeyModifiers};
use crossterm::terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen};
use crossterm::ExecutableCommand;
use ratatui::prelude::*;
use ratatui::widgets::{Block, Borders, Clear, List, ListItem, ListState, Paragraph, Wrap};
use serde::Deserialize;
use serde_json::{json, Value};

const BACKENDS: [&str; 4] = ["snapback", "convex", "supabase", "sqlite"];
const DEFAULT_MODEL: &str = "anthropic/claude-haiku-4.5";

#[derive(Debug, Clone, Deserialize)]
struct MessageRow {
    #[serde(rename = "_id")]
    id: String,
    role: String,
    content: String,
    status: String,
}

struct Gateway {
    origin: String,
    client: reqwest::blocking::Client,
}

impl Gateway {
    fn rpc(&self, backend: &str, op: &str, args: Value) -> Result<Value> {
        let payload: Value = self
            .client
            .post(format!("{}/rpc", self.origin))
            .json(&json!({ "backend": backend, "op": op, "args": args }))
            .send()?
            .json()?;
        if payload["ok"].as_bool() != Some(true) {
            anyhow::bail!("{}.{} failed: {}", backend, op, payload["error"]);
        }
        Ok(payload["value"].clone())
    }

    fn models(&self) -> Result<(Vec<String>, Vec<String>)> {
        let payload: Value = self
            .client
            .get(format!("{}/models", self.origin))
            .send()?
            .json()?;
        let featured = payload["featured"]
            .as_array()
            .map(|rows| rows.iter().filter_map(|v| v.as_str().map(String::from)).collect())
            .unwrap_or_default();
        let all = payload["models"]
            .as_array()
            .map(|rows| {
                rows.iter()
                    .filter_map(|v| v["id"].as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();
        Ok((featured, all))
    }
}

enum Cmd {
    Send {
        backend: usize,
        content: String,
        model: String,
        conversation: Option<String>,
    },
    Stop,
}

enum Update {
    Messages(Vec<MessageRow>),
    Conversation(String),
    Catalog(Vec<String>, Vec<String>),
    Error(String),
}

struct App {
    backend: usize,
    model: String,
    conversation_id: Option<String>,
    messages: Vec<MessageRow>,
    draft: String,
    error: Option<String>,
    picker: Option<PickerState>,
    scroll_from_bottom: u16,
    autodemo: bool,
}

struct PickerState {
    query: String,
    featured: Vec<String>,
    all: Vec<String>,
    list: ListState,
}

impl PickerState {
    fn rows(&self) -> Vec<String> {
        let needle = self.query.trim().to_lowercase();
        if needle.is_empty() {
            let mut rows = self.featured.clone();
            rows.extend(self.all.iter().filter(|id| !self.featured.contains(id)).cloned());
            rows
        } else {
            self.all
                .iter()
                .filter(|id| id.to_lowercase().contains(&needle))
                .cloned()
                .collect()
        }
    }
}

fn conversation_title(first: &str) -> String {
    let joined = first.split_whitespace().collect::<Vec<_>>().join(" ");
    if joined.chars().count() <= 40 {
        joined
    } else {
        format!("{}…", joined.chars().take(39).collect::<String>())
    }
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let flag = |name: &str| args.iter().any(|a| a == name);
    let opt = |name: &str| {
        args.iter()
            .position(|a| a == name)
            .and_then(|at| args.get(at + 1))
            .cloned()
    };

    let origin = opt("--gateway")
        .or_else(|| std::env::var("CHAT_GATEWAY_ORIGIN").ok())
        .unwrap_or_else(|| "http://127.0.0.1:4470".into());
    let initial_backend = opt("--backend")
        .or_else(|| std::env::var("CHAT_BACKEND").ok())
        .and_then(|name| BACKENDS.iter().position(|b| *b == name))
        .unwrap_or(3); // sqlite
    let autodemo = flag("--autodemo") || std::env::var("CHAT_AUTODEMO").as_deref() == Ok("1");

    let (update_tx, update_rx) = mpsc::channel::<Update>();
    let (cmd_tx, cmd_rx) = mpsc::channel::<Cmd>();

    // Worker thread: owns all HTTP; the UI thread never blocks on the network.
    {
        let origin = origin.clone();
        let update_tx = update_tx.clone();
        thread::spawn(move || {
            let gateway = Gateway {
                origin,
                client: reqwest::blocking::Client::builder()
                    .timeout(Duration::from_secs(20))
                    .build()
                    .expect("client"),
            };
            if let Ok(catalog) = gateway.models() {
                let _ = update_tx.send(Update::Catalog(catalog.0, catalog.1));
            }
            let mut watching: Option<(usize, String)> = None;
            let mut last_poll = Instant::now() - Duration::from_secs(1);
            loop {
                while let Ok(cmd) = cmd_rx.try_recv() {
                    match cmd {
                        Cmd::Send { backend, content, model, conversation } => {
                            let backend_name = BACKENDS[backend];
                            let conversation = match conversation {
                                Some(existing) => existing,
                                None => match gateway.rpc(
                                    backend_name,
                                    "createConversation",
                                    json!({ "model": model, "title": conversation_title(&content) }),
                                ) {
                                    Ok(value) => {
                                        let id = value.as_str().unwrap_or_default().to_string();
                                        let _ = update_tx.send(Update::Conversation(id.clone()));
                                        id
                                    }
                                    Err(error) => {
                                        let _ = update_tx.send(Update::Error(error.to_string()));
                                        continue;
                                    }
                                },
                            };
                            if let Err(error) = gateway.rpc(
                                backend_name,
                                "sendMessage",
                                json!({ "conversationId": conversation, "content": content }),
                            ) {
                                let _ = update_tx.send(Update::Error(error.to_string()));
                            }
                            watching = Some((backend, conversation));
                        }
                        Cmd::Stop => watching = None,
                    }
                }
                if let Some((backend, conversation)) = &watching {
                    if last_poll.elapsed() >= Duration::from_millis(700) {
                        last_poll = Instant::now();
                        match gateway.rpc(
                            BACKENDS[*backend],
                            "listMessages",
                            json!({ "conversationId": conversation }),
                        ) {
                            Ok(value) => {
                                if let Ok(rows) = serde_json::from_value::<Vec<MessageRow>>(value) {
                                    let _ = update_tx.send(Update::Messages(rows));
                                }
                            }
                            Err(error) => {
                                let _ = update_tx.send(Update::Error(error.to_string()));
                            }
                        }
                    }
                }
                thread::sleep(Duration::from_millis(40));
            }
        });
    }

    let mut app = App {
        backend: initial_backend,
        model: DEFAULT_MODEL.to_string(),
        conversation_id: None,
        messages: Vec::new(),
        draft: String::new(),
        error: None,
        picker: None,
        scroll_from_bottom: 0,
        autodemo,
    };

    enable_raw_mode()?;
    io::stdout().execute(EnterAlternateScreen)?;
    let mut terminal = Terminal::new(CrosstermBackend::new(io::stdout()))?;

    let started = Instant::now();
    let mut autodemo_sent = false;
    let mut catalog: (Vec<String>, Vec<String>) = (Vec::new(), Vec::new());
    let result = loop {
        while let Ok(update) = update_rx.try_recv() {
            match update {
                Update::Messages(rows) => {
                    app.messages = rows;
                    app.error = None;
                }
                Update::Conversation(id) => app.conversation_id = Some(id),
                Update::Catalog(featured, all) => catalog = (featured, all),
                Update::Error(message) => app.error = Some(message),
            }
        }

        if app.autodemo && !autodemo_sent && started.elapsed() > Duration::from_secs(2) {
            autodemo_sent = true;
            let text = format!(
                "Reply with one short sentence praising the {} backend.",
                BACKENDS[app.backend]
            );
            let _ = cmd_tx.send(Cmd::Send {
                backend: app.backend,
                content: text,
                model: app.model.clone(),
                conversation: app.conversation_id.clone(),
            });
        }
        // Autodemo exits once the assistant reply lands, so a scripted run
        // (tmux or CI) can capture the final frame and stop deterministically.
        if app.autodemo
            && autodemo_sent
            && app.messages.iter().any(|m| m.role == "assistant" && m.status == "complete")
            && started.elapsed() > Duration::from_secs(6)
        {
            break Ok(());
        }

        terminal.draw(|frame| draw(frame, &app))?;

        if event::poll(Duration::from_millis(60))? {
            if let Event::Key(key) = event::read()? {
                if key.kind != KeyEventKind::Press {
                    continue;
                }
                if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
                    break Ok(());
                }
                if let Some(picker) = app.picker.as_mut() {
                    match key.code {
                        KeyCode::Esc => app.picker = None,
                        KeyCode::Up => {
                            let at = picker.list.selected().unwrap_or(0);
                            picker.list.select(Some(at.saturating_sub(1)));
                        }
                        KeyCode::Down => {
                            let rows = picker.rows().len();
                            let at = picker.list.selected().unwrap_or(0);
                            picker.list.select(Some((at + 1).min(rows.saturating_sub(1))));
                        }
                        KeyCode::Enter => {
                            let rows = picker.rows();
                            if let Some(id) = rows.get(picker.list.selected().unwrap_or(0)) {
                                app.model = id.clone();
                                app.conversation_id = None;
                                app.messages.clear();
                                let _ = cmd_tx.send(Cmd::Stop);
                            }
                            app.picker = None;
                        }
                        KeyCode::Backspace => {
                            picker.query.pop();
                            picker.list.select(Some(0));
                        }
                        KeyCode::Char(c) => {
                            picker.query.push(c);
                            picker.list.select(Some(0));
                        }
                        _ => {}
                    }
                    continue;
                }
                match key.code {
                    KeyCode::Tab => {
                        app.backend = (app.backend + 1) % BACKENDS.len();
                        app.conversation_id = None;
                        app.messages.clear();
                        app.error = None;
                        let _ = cmd_tx.send(Cmd::Stop);
                    }
                    KeyCode::Char('p') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                        let mut list = ListState::default();
                        list.select(Some(0));
                        app.picker = Some(PickerState {
                            query: String::new(),
                            featured: catalog.0.clone(),
                            all: catalog.1.clone(),
                            list,
                        });
                    }
                    KeyCode::Char('n') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                        app.conversation_id = None;
                        app.messages.clear();
                        app.error = None;
                        let _ = cmd_tx.send(Cmd::Stop);
                    }
                    KeyCode::Enter => {
                        let text = app.draft.trim().to_string();
                        if !text.is_empty() {
                            app.draft.clear();
                            let _ = cmd_tx.send(Cmd::Send {
                                backend: app.backend,
                                content: text,
                                model: app.model.clone(),
                                conversation: app.conversation_id.clone(),
                            });
                        }
                    }
                    KeyCode::Backspace => {
                        app.draft.pop();
                    }
                    KeyCode::Up => app.scroll_from_bottom = app.scroll_from_bottom.saturating_add(1),
                    KeyCode::Down => app.scroll_from_bottom = app.scroll_from_bottom.saturating_sub(1),
                    KeyCode::Char(c) => app.draft.push(c),
                    _ => {}
                }
            }
        }
    };

    disable_raw_mode()?;
    io::stdout().execute(LeaveAlternateScreen)?;
    if app.autodemo {
        for message in &app.messages {
            println!("{} {} | {}", message.role, message.status, message.content);
        }
    }
    result
}

fn draw(frame: &mut Frame, app: &App) {
    let [header, thread, error_row, composer, footer] = Layout::vertical([
        Constraint::Length(2),
        Constraint::Min(3),
        Constraint::Length(if app.error.is_some() { 1 } else { 0 }),
        Constraint::Length(3),
        Constraint::Length(1),
    ])
    .areas(frame.area());

    let mut chips: Vec<Span> = Vec::new();
    for (at, name) in BACKENDS.iter().enumerate() {
        if at > 0 {
            chips.push(Span::raw(" "));
        }
        let style = if at == app.backend {
            Style::new().fg(Color::Black).bg(Color::White).bold()
        } else {
            Style::new().fg(Color::DarkGray)
        };
        chips.push(Span::styled(format!(" {} ", name), style));
    }
    frame.render_widget(
        Paragraph::new(vec![
            Line::from(chips),
            Line::from(vec![
                Span::styled(app.model.clone(), Style::new().fg(Color::Cyan)),
                Span::styled("  built with Ratatui", Style::new().fg(Color::DarkGray)),
            ]),
        ]),
        header,
    );

    let mut lines: Vec<Line> = Vec::new();
    if app.messages.is_empty() {
        lines.push(Line::from(Span::styled(
            format!("Chat via {} — say something to start.", BACKENDS[app.backend]),
            Style::new().fg(Color::DarkGray),
        )));
    }
    for message in &app.messages {
        let (who, style) = if message.role == "user" {
            ("you", Style::new().fg(Color::Blue).bold())
        } else {
            ("ai ", Style::new().fg(Color::Green).bold())
        };
        let body = if message.content.is_empty() {
            "…".to_string()
        } else if message.status == "streaming" {
            format!("{} ▍", message.content)
        } else {
            message.content.clone()
        };
        lines.push(Line::from(vec![
            Span::styled(format!("{} ", who), style),
            Span::raw(body),
        ]));
        lines.push(Line::raw(""));
    }
    let inner_height = thread.height.saturating_sub(2);
    let total: u16 = lines
        .iter()
        .map(|line| {
            let width = thread.width.saturating_sub(2).max(1) as usize;
            ((line.width().max(1) + width - 1) / width) as u16
        })
        .sum();
    let scroll = total
        .saturating_sub(inner_height)
        .saturating_sub(app.scroll_from_bottom);
    frame.render_widget(
        Paragraph::new(lines)
            .wrap(Wrap { trim: false })
            .scroll((scroll, 0))
            .block(Block::default().borders(Borders::ALL).title("conversation")),
        thread,
    );

    if let Some(error) = &app.error {
        frame.render_widget(
            Paragraph::new(error.clone()).style(Style::new().fg(Color::Red)),
            error_row,
        );
    }

    frame.render_widget(
        Paragraph::new(app.draft.clone())
            .block(Block::default().borders(Borders::ALL).title("message")),
        composer,
    );

    frame.render_widget(
        Paragraph::new("Enter send · Tab backend · Ctrl-P model · Ctrl-N new chat · ↑/↓ scroll · Ctrl-C quit")
            .style(Style::new().fg(Color::DarkGray)),
        footer,
    );

    if let Some(picker) = &app.picker {
        let area = centered(frame.area(), 70, 80);
        frame.render_widget(Clear, area);
        let rows = picker.rows();
        let items: Vec<ListItem> = rows
            .iter()
            .map(|id| {
                let marker = if picker.featured.contains(id) { "★ " } else { "  " };
                ListItem::new(format!("{}{}", marker, id))
            })
            .collect();
        let mut list_state = ListState::default();
        list_state.select(picker.list.selected());
        frame.render_stateful_widget(
            List::new(items)
                .highlight_style(Style::new().bg(Color::Blue).fg(Color::White))
                .block(
                    Block::default()
                        .borders(Borders::ALL)
                        .title(format!("choose model — search: {}▍ (Esc closes)", picker.query)),
                ),
            area,
            &mut list_state,
        );
    }
}

fn centered(area: Rect, percent_x: u16, percent_y: u16) -> Rect {
    let [_, mid_v, _] = Layout::vertical([
        Constraint::Percentage((100 - percent_y) / 2),
        Constraint::Percentage(percent_y),
        Constraint::Percentage((100 - percent_y) / 2),
    ])
    .areas(area);
    let [_, mid, _] = Layout::horizontal([
        Constraint::Percentage((100 - percent_x) / 2),
        Constraint::Percentage(percent_x),
        Constraint::Percentage((100 - percent_x) / 2),
    ])
    .areas(mid_v);
    mid
}
