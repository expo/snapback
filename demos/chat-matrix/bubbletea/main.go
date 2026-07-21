// chat-matrix Bubble Tea cell: the Elm architecture in Go, same product as
// every other authoring stack, over the gateway's portable /rpc surface.
//
//	go run . [--backend sqlite] [--autodemo] [--gateway http://...]
//
// Keys: Enter send · Tab backend · Ctrl-P model · Ctrl-N new chat · Ctrl-C quit
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

var backends = []string{"snapback", "convex", "supabase", "sqlite"}

const defaultModel = "anthropic/claude-haiku-4.5"

type messageRow struct {
	ID      string `json:"_id"`
	Role    string `json:"role"`
	Content string `json:"content"`
	Status  string `json:"status"`
}

type gateway struct{ origin string }

func (g gateway) rpc(backend, op string, args map[string]any, out any) error {
	body, _ := json.Marshal(map[string]any{"backend": backend, "op": op, "args": args})
	response, err := http.Post(g.origin+"/rpc", "application/json", bytes.NewReader(body))
	if err != nil {
		return err
	}
	defer response.Body.Close()
	var envelope struct {
		Ok    bool            `json:"ok"`
		Value json.RawMessage `json:"value"`
		Error *string         `json:"error"`
	}
	if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		return err
	}
	if !envelope.Ok {
		if envelope.Error != nil {
			return fmt.Errorf("%s.%s failed: %s", backend, op, *envelope.Error)
		}
		return fmt.Errorf("%s.%s failed", backend, op)
	}
	if out != nil {
		return json.Unmarshal(envelope.Value, out)
	}
	return nil
}

func (g gateway) models() (featured []string, all []string, err error) {
	response, err := http.Get(g.origin + "/models")
	if err != nil {
		return nil, nil, err
	}
	defer response.Body.Close()
	var payload struct {
		Featured []string `json:"featured"`
		Models   []struct {
			ID string `json:"id"`
		} `json:"models"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return nil, nil, err
	}
	for _, entry := range payload.Models {
		all = append(all, entry.ID)
	}
	return payload.Featured, all, nil
}

func conversationTitle(first string) string {
	joined := strings.Join(strings.Fields(first), " ")
	runes := []rune(joined)
	if len(runes) <= 40 {
		return joined
	}
	return string(runes[:39]) + "…"
}

// Messages flowing back into Update from commands.
type pollMsg []messageRow
type conversationMsg string
type catalogMsg struct{ featured, all []string }
type errMsg string
type tickMsg time.Time
type autodemoMsg struct{}

type model struct {
	gw             gateway
	backendAt      int
	modelID        string
	conversationID string
	messages       []messageRow
	input          textinput.Model
	err            string
	autodemo       bool
	autodemoFired  bool
	startedAt      time.Time
	pickerOpen     bool
	pickerQuery    string
	pickerAt       int
	featured       []string
	allModels      []string
}

func (m model) backend() string { return backends[m.backendAt] }

func tick() tea.Cmd {
	return tea.Tick(700*time.Millisecond, func(t time.Time) tea.Msg { return tickMsg(t) })
}

func (m model) Init() tea.Cmd {
	cmds := []tea.Cmd{textinput.Blink, tick(), func() tea.Msg {
		featured, all, err := m.gw.models()
		if err != nil {
			return errMsg(err.Error())
		}
		return catalogMsg{featured, all}
	}}
	if m.autodemo {
		cmds = append(cmds, tea.Tick(2*time.Second, func(time.Time) tea.Msg { return autodemoMsg{} }))
	}
	return tea.Batch(cmds...)
}

func (m model) send(content string) (model, tea.Cmd) {
	trimmed := strings.TrimSpace(content)
	if trimmed == "" {
		return m, nil
	}
	m.input.SetValue("")
	backend := m.backend()
	conversation := m.conversationID
	modelID := m.modelID
	return m, func() tea.Msg {
		if conversation == "" {
			var id string
			if err := (m.gw).rpc(backend, "createConversation", map[string]any{
				"model": modelID, "title": conversationTitle(trimmed),
			}, &id); err != nil {
				return errMsg(err.Error())
			}
			conversation = id
		}
		if err := m.gw.rpc(backend, "sendMessage", map[string]any{
			"conversationId": conversation, "content": trimmed,
		}, nil); err != nil {
			return errMsg(err.Error())
		}
		return conversationMsg(conversation)
	}
}

func (m model) pickerRows() []string {
	needle := strings.ToLower(strings.TrimSpace(m.pickerQuery))
	if needle == "" {
		rows := append([]string{}, m.featured...)
		for _, id := range m.allModels {
			isFeatured := false
			for _, f := range m.featured {
				if f == id {
					isFeatured = true
					break
				}
			}
			if !isFeatured {
				rows = append(rows, id)
			}
		}
		return rows
	}
	var rows []string
	for _, id := range m.allModels {
		if strings.Contains(strings.ToLower(id), needle) {
			rows = append(rows, id)
		}
	}
	return rows
}

func (m model) newChat() model {
	m.conversationID = ""
	m.messages = nil
	m.err = ""
	return m
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		if m.pickerOpen {
			switch msg.String() {
			case "esc":
				m.pickerOpen = false
			case "up":
				if m.pickerAt > 0 {
					m.pickerAt--
				}
			case "down":
				if m.pickerAt < len(m.pickerRows())-1 {
					m.pickerAt++
				}
			case "enter":
				rows := m.pickerRows()
				if m.pickerAt < len(rows) {
					m.modelID = rows[m.pickerAt]
					m = m.newChat()
				}
				m.pickerOpen = false
			case "backspace":
				if len(m.pickerQuery) > 0 {
					m.pickerQuery = m.pickerQuery[:len(m.pickerQuery)-1]
					m.pickerAt = 0
				}
			default:
				if len(msg.Runes) == 1 {
					m.pickerQuery += string(msg.Runes)
					m.pickerAt = 0
				}
			}
			return m, nil
		}
		switch msg.String() {
		case "ctrl+c":
			return m, tea.Quit
		case "tab":
			m.backendAt = (m.backendAt + 1) % len(backends)
			m = m.newChat()
			return m, nil
		case "ctrl+p":
			m.pickerOpen = true
			m.pickerQuery = ""
			m.pickerAt = 0
			return m, nil
		case "ctrl+n":
			return m.newChat(), nil
		case "enter":
			return m.send(m.input.Value())
		}
	case autodemoMsg:
		m.autodemoFired = true
		return m.send(fmt.Sprintf("Reply with one short sentence praising the %s backend.", m.backend()))
	case conversationMsg:
		m.conversationID = string(msg)
		return m, nil
	case catalogMsg:
		m.featured, m.allModels = msg.featured, msg.all
		return m, nil
	case pollMsg:
		m.messages = msg
		m.err = ""
		if m.autodemo && m.autodemoFired {
			for _, row := range m.messages {
				if row.Role == "assistant" && row.Status == "complete" {
					return m, tea.Quit
				}
			}
		}
		return m, nil
	case errMsg:
		m.err = string(msg)
		return m, nil
	case tickMsg:
		if m.conversationID == "" {
			return m, tick()
		}
		backend, conversation := m.backend(), m.conversationID
		return m, tea.Batch(tick(), func() tea.Msg {
			var rows []messageRow
			if err := m.gw.rpc(backend, "listMessages", map[string]any{"conversationId": conversation}, &rows); err != nil {
				return errMsg(err.Error())
			}
			return pollMsg(rows)
		})
	}
	var cmd tea.Cmd
	m.input, cmd = m.input.Update(msg)
	return m, cmd
}

var (
	chipActive   = lipgloss.NewStyle().Reverse(true).Bold(true)
	chipInactive = lipgloss.NewStyle().Faint(true)
	modelStyle   = lipgloss.NewStyle().Foreground(lipgloss.Color("14"))
	faint        = lipgloss.NewStyle().Faint(true)
	youStyle     = lipgloss.NewStyle().Foreground(lipgloss.Color("12")).Bold(true)
	aiStyle      = lipgloss.NewStyle().Foreground(lipgloss.Color("10")).Bold(true)
	errStyle     = lipgloss.NewStyle().Foreground(lipgloss.Color("9"))
	panel        = lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).Padding(0, 1).Width(96)
)

func (m model) View() string {
	var b strings.Builder
	var chips []string
	for at, name := range backends {
		if at == m.backendAt {
			chips = append(chips, chipActive.Render(" "+name+" "))
		} else {
			chips = append(chips, chipInactive.Render(" "+name+" "))
		}
	}
	b.WriteString(strings.Join(chips, " ") + "\n")
	b.WriteString(modelStyle.Render(m.modelID) + "  " + faint.Render("built with Bubble Tea") + "\n")

	var thread strings.Builder
	if len(m.messages) == 0 {
		thread.WriteString(faint.Render(fmt.Sprintf("Chat via %s — say something to start.", m.backend())))
	}
	visible := m.messages
	if len(visible) > 10 {
		visible = visible[len(visible)-10:]
	}
	for at, row := range visible {
		who := aiStyle.Render("ai  ")
		if row.Role == "user" {
			who = youStyle.Render("you ")
		}
		content := row.Content
		if content == "" {
			content = "…"
		}
		if row.Status == "streaming" {
			content += " ▍"
		}
		thread.WriteString(who + content)
		if at < len(visible)-1 {
			thread.WriteString("\n\n")
		}
	}
	b.WriteString(panel.Render(thread.String()) + "\n")

	if m.err != "" {
		b.WriteString(errStyle.Render(m.err) + "\n")
	}

	if m.pickerOpen {
		var picker strings.Builder
		picker.WriteString("choose model — search: " + m.pickerQuery + "▍ (Esc closes)\n")
		rows := m.pickerRows()
		start := m.pickerAt - 4
		if start < 0 {
			start = 0
		}
		end := start + 9
		if end > len(rows) {
			end = len(rows)
		}
		for at := start; at < end; at++ {
			marker := "  "
			for _, f := range m.featured {
				if f == rows[at] {
					marker = "★ "
					break
				}
			}
			line := marker + rows[at]
			if at == m.pickerAt {
				line = chipActive.Render(line)
			}
			picker.WriteString(line + "\n")
		}
		b.WriteString(panel.Render(strings.TrimRight(picker.String(), "\n")) + "\n")
	} else {
		b.WriteString(panel.Render(m.input.View()) + "\n")
	}
	b.WriteString(faint.Render("Enter send · Tab backend · Ctrl-P model · Ctrl-N new chat · Ctrl-C quit"))
	return b.String()
}

func main() {
	args := os.Args[1:]
	flag := func(name string) bool {
		for _, a := range args {
			if a == name {
				return true
			}
		}
		return false
	}
	opt := func(name string) string {
		for at, a := range args {
			if a == name && at+1 < len(args) {
				return args[at+1]
			}
		}
		return ""
	}

	origin := opt("--gateway")
	if origin == "" {
		origin = os.Getenv("CHAT_GATEWAY_ORIGIN")
	}
	if origin == "" {
		origin = "http://127.0.0.1:4470"
	}
	backendAt := 3 // sqlite
	requested := opt("--backend")
	if requested == "" {
		requested = os.Getenv("CHAT_BACKEND")
	}
	for at, name := range backends {
		if name == requested {
			backendAt = at
		}
	}

	input := textinput.New()
	input.Placeholder = "Message…"
	input.Focus()

	m := model{
		gw:        gateway{origin: origin},
		backendAt: backendAt,
		modelID:   defaultModel,
		input:     input,
		autodemo:  flag("--autodemo") || os.Getenv("CHAT_AUTODEMO") == "1",
		startedAt: time.Now(),
	}

	final, err := tea.NewProgram(m).Run()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if m.autodemo {
		if finalModel, ok := final.(model); ok {
			for _, row := range finalModel.messages {
				fmt.Printf("%s %s | %s\n", row.Role, row.Status, row.Content)
			}
		}
	}
}
