// Full admin inspect contains source, raw operational text, and local paths.
// A freshly served loopback instance therefore asks the operator for the
// startup/ready-descriptor token before booting the console. Build the prompt
// only with DOM text/property APIs: server error text never crosses an HTML
// parser on this privileged origin.
export function renderAdminTokenPrompt(document, { message = '', onSubmit }) {
  const root = document.getElementById('exact-root');
  if (!root) return false;

  const panel = document.createElement('form');
  panel.style.cssText =
    'max-width:560px;margin:48px auto;padding:24px;font:14px system-ui,sans-serif;color:#24221f';

  const title = document.createElement('h1');
  title.textContent = 'Admin token required';
  const help = document.createElement('p');
  help.textContent =
    'Paste the token printed when Snapback started, or read it from the trusted ready descriptor as the same local user.';
  const input = document.createElement('input');
  input.type = 'password';
  input.name = 'admin-token';
  input.autocomplete = 'current-password';
  input.required = true;
  input.spellcheck = false;
  input.placeholder = 'SNAPBACK_ADMIN_TOKEN';
  input.style.cssText = 'box-sizing:border-box;width:100%;padding:10px;margin:12px 0';
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.textContent = 'Open admin console';
  const error = document.createElement('pre');
  error.style.cssText = 'color:#c0362c;white-space:pre-wrap';
  error.textContent = message;

  panel.append(title, help, input, submit, error);
  panel.addEventListener('submit', async (event) => {
    event.preventDefault();
    const token = String(input.value || '').trim();
    if (!token) return;
    submit.disabled = true;
    error.textContent = '';
    try {
      await onSubmit(token);
    } catch (failure) {
      error.textContent = failure instanceof Error ? failure.message : String(failure);
      submit.disabled = false;
      input.focus();
      input.select();
    }
  });
  root.replaceChildren(panel);
  input.focus();
  return true;
}
