; Matches chunk A's TextMate scopes. More specific context overrides lexical class.
(identifier) @variable
(declaration_keyword) @keyword
(table_keyword) @keyword
(keyword) @keyword
(type) @type
(builtin) @variable.builtin
(comment) @comment
(string) @string
(number) @number
(operator) @operator
(declaration_name) @type
(index_read table: (_) @type)
(call function: (_) @function)
(property name: (_) @property)
; Column, parameter and shape labels (the expression grammar is intentionally broad).
(expression (_) @property . (operator) @_colon
  (#eq? @_colon ":"))

(missing_delimiter) @error
