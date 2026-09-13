/**
 * ブラウザ内で実行して、ページのフォーム項目を読み取る式。
 *
 * page.evaluate に文字列を渡すと「式」として評価されるため、
 * 関数のままだと関数オブジェクトが返り、シリアライズできず undefined になる。
 * 即時実行式にして配列を返す。
 *
 * 外部の変数を参照しない自己完結した式にしている（ブラウザ側で実行されるため）。
 */
export const EXTRACT_FORM_FIELDS = `(() => {
  const labelTextFor = (el) => {
    // 1. label[for]
    if (el.id) {
      const byFor = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (byFor && byFor.textContent) return byFor.textContent.trim();
    }
    // 2. 親の label
    const parentLabel = el.closest('label');
    if (parentLabel && parentLabel.textContent) return parentLabel.textContent.trim();
    // 3. テーブル行の見出しセル（日本語フォームで最も多い形）
    const row = el.closest('tr');
    if (row) {
      const head = row.querySelector('th');
      if (head && head.textContent) return head.textContent.trim();
    }
    // 4. dl/dt
    const dd = el.closest('dd');
    if (dd) {
      const dt = dd.previousElementSibling;
      if (dt && dt.tagName === 'DT' && dt.textContent) return dt.textContent.trim();
    }
    // 5. 直前の要素
    const prev = el.previousElementSibling;
    if (prev && prev.textContent && prev.textContent.trim().length <= 40) return prev.textContent.trim();
    return null;
  };

  const uniqueSelector = (el, index) => {
    if (el.id) return '#' + CSS.escape(el.id);
    if (el.name) {
      const same = document.querySelectorAll('[name="' + CSS.escape(el.name) + '"]');
      if (same.length === 1) return '[name="' + CSS.escape(el.name) + '"]';
      return '[name="' + CSS.escape(el.name) + '"]:nth-of-type(' + (Array.from(same).indexOf(el) + 1) + ')';
    }
    return null;
  };

  const kindOf = (el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'textarea') return 'textarea';
    if (tag === 'select') return 'select';
    const t = (el.type || 'text').toLowerCase();
    if (t === 'email') return 'email';
    if (t === 'tel') return 'tel';
    if (t === 'checkbox') return 'checkbox';
    if (t === 'radio') return 'radio';
    if (['text', 'search', 'url', 'number'].includes(t)) return 'text';
    return 'other';
  };

  const nodes = Array.from(document.querySelectorAll('input, textarea, select'));
  const fields = [];
  nodes.forEach((el, i) => {
    const t = (el.type || '').toLowerCase();
    if (['hidden', 'submit', 'button', 'reset', 'image', 'file', 'password'].includes(t)) return;
    if (el.disabled || el.readOnly) return;
    const rect = el.getBoundingClientRect();
    const styles = window.getComputedStyle(el);
    if (styles.display === 'none' || styles.visibility === 'hidden') return;
    if (rect.width === 0 && rect.height === 0) return;
    const selector = uniqueSelector(el, i);
    if (!selector) return;
    const label = labelTextFor(el);
    fields.push({
      selector: selector,
      kind: kindOf(el),
      name: el.name || null,
      id: el.id || null,
      label: label,
      placeholder: el.placeholder || null,
      required: el.required || /必須/.test(label || ''),
      maxLength: el.maxLength && el.maxLength > 0 ? el.maxLength : null,
      options: el.tagName.toLowerCase() === 'select'
        ? Array.from(el.options).map((o) => ({ value: o.value, text: (o.textContent || '').trim() }))
        : undefined,
    });
  });
  return fields;
})()`;
