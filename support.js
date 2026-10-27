/* Motor mínimo para mostrar las páginas de Barolo fuera de Claude (Netlify u otro hosting estático). */
(function () {
  var hide = document.createElement('style');
  hide.textContent = 'x-dc{display:none}#dc-root{display:block}';
  document.head.appendChild(hide);

  function DCLogic(props) { this.props = props || {}; this.state = {}; }
  DCLogic.prototype.setState = function (p) {
    var next = typeof p === 'function' ? p(this.state, this.props) : p;
    this.state = Object.assign({}, this.state, next || {});
    schedule();
  };
  DCLogic.prototype.forceUpdate = function () { schedule(); };
  window.DCLogic = DCLogic;

  var HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  var WHOLE = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;
  var comp, tpl, root, pending = false;

  function lookup(scope, expr) {
    expr = expr.trim();
    if (expr === 'true') return true;
    if (expr === 'false') return false;
    if (expr === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(expr)) return Number(expr);
    if (/^'.*'$|^".*"$/.test(expr)) return expr.slice(1, -1);
    var parts = expr.split('.'), v = scope;
    for (var i = 0; i < parts.length; i++) {
      if (v == null) return undefined;
      v = v[parts[i]];
    }
    return v;
  }
  function interp(str, scope) {
    return str.replace(HOLE, function (_, e) { var v = lookup(scope, e); return v == null ? '' : String(v); });
  }
  function mapHref(h) {
    if (typeof h !== 'string') return h;
    return h.replace(/^\/?Main\.dc\.html/, 'index.html').replace(/^\/?([A-Za-z0-9_-]+)\.dc\.html/, function (_, n) { return n.toLowerCase() + '.html'; });
  }
  function eventName(attr, el) {
    var n = attr.slice(2).toLowerCase();
    if (n === 'change') {
      var t = (el.getAttribute && el.getAttribute('type')) || '';
      if (el.localName === 'textarea' || (el.localName === 'input' && !/checkbox|radio|file/.test(t))) return 'input';
    }
    if (n === 'doubleclick') return 'dblclick';
    return n;
  }

  function renderNode(node, scope) {
    if (node.nodeType === 3) return [document.createTextNode(interp(node.nodeValue, scope))];
    if (node.nodeType !== 1) return [];
    var tag = node.localName;
    var out = [];
    if (tag === 'sc-for') {
      var list = lookup(scope, (node.getAttribute('list') || '').replace(/[{}]/g, ''));
      var as = node.getAttribute('as') || 'item';
      (Array.isArray(list) ? list : []).forEach(function (item, i) {
        var s = Object.create(scope); s[as] = item; s.$index = i;
        node.childNodes.forEach(function (c) { out = out.concat(renderNode(c, s)); });
      });
      return out;
    }
    if (tag === 'sc-if') {
      var cond = lookup(scope, (node.getAttribute('value') || '').replace(/[{}]/g, ''));
      if (cond) node.childNodes.forEach(function (c) { out = out.concat(renderNode(c, scope)); });
      return out;
    }
    if (tag === 'helmet') return [];
    var el = node.namespaceURI === 'http://www.w3.org/2000/svg'
      ? document.createElementNS(node.namespaceURI, node.localName)
      : document.createElement(node.localName);
    var valueProp;
    Array.prototype.forEach.call(node.attributes, function (a) {
      var name = a.name, val = a.value, m = val.match(WHOLE);
      if (/^hint-/.test(name)) return;
      if (/^on[a-z]+$/.test(name) && m) {
        var fn = lookup(scope, m[1]);
        if (typeof fn === 'function') el.addEventListener(eventName(name, node), function (ev) { fn(ev); });
        return;
      }
      var v = m ? lookup(scope, m[1]) : interp(val, scope);
      if (name === 'href') v = mapHref(v);
      if ((name === 'value') && (node.localName === 'input' || node.localName === 'textarea')) { valueProp = v; return; }
      if (v === false || v == null) return;
      el.setAttribute(name, v === true ? '' : String(v));
    });
    node.childNodes.forEach(function (c) { renderNode(c, scope).forEach(function (n) { el.appendChild(n); }); });
    if (valueProp !== undefined) el.value = valueProp == null ? '' : String(valueProp);
    return [el];
  }

  function render() {
    pending = false;
    var vals = comp.renderVals ? comp.renderVals() : {};
    var fields = root.querySelectorAll('input,textarea,select');
    var active = document.activeElement, fIdx = -1, sel = null;
    for (var i = 0; i < fields.length; i++) if (fields[i] === active) fIdx = i;
    if (fIdx > -1 && active.selectionStart != null) { try { sel = [active.selectionStart, active.selectionEnd]; } catch (e) {} }
    var opened = [];
    root.querySelectorAll('details').forEach(function (d, i) { if (d.open) opened.push(i); });
    var frag = document.createDocumentFragment();
    tpl.childNodes.forEach(function (c) { renderNode(c, vals).forEach(function (n) { frag.appendChild(n); }); });
    root.innerHTML = '';
    root.appendChild(frag);
    var ds = root.querySelectorAll('details');
    opened.forEach(function (i) { if (ds[i]) ds[i].open = true; });
    if (fIdx > -1) {
      var nf = root.querySelectorAll('input,textarea,select')[fIdx];
      if (nf) { nf.focus({ preventScroll: true }); if (sel) { try { nf.setSelectionRange(sel[0], sel[1]); } catch (e) {} } }
    }
  }
  function schedule() { if (!pending) { pending = true; Promise.resolve().then(render); } }

  function boot() {
    var xdc = document.querySelector('x-dc');
    if (!xdc) return;
    var helmet = xdc.querySelector('helmet');
    if (helmet) Array.prototype.slice.call(helmet.childNodes).forEach(function (n) { document.head.appendChild(n); });
    tpl = xdc;
    root = document.createElement('div');
    root.id = 'dc-root';
    xdc.parentNode.insertBefore(root, xdc);
    var script = document.querySelector('script[data-dc-script]');
    var props = {};
    try {
      var decl = JSON.parse(script.getAttribute('data-props') || '{}');
      Object.keys(decl).forEach(function (k) { if (k.charAt(0) !== '$' && decl[k] && 'default' in decl[k]) props[k] = decl[k]['default']; });
    } catch (e) {}
    var Component = new Function('DCLogic', script.textContent + '\n;return Component;')(DCLogic);
    comp = new Component(props);
    if (!comp.props) comp.props = props;
    render();
    if (location.hash) { var t = document.getElementById(location.hash.slice(1)); if (t) t.scrollIntoView(); }
    if (comp.componentDidMount) comp.componentDidMount();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
