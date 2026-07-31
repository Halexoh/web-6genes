/* ══════════════════════════════════════════════════════════════════════
   MEDICIÓN
   Todos los eventos van a window.dataLayer. Nunca se llama a GA4, GTM o
   a un píxel desde acá: conectar o cambiar de herramienta después es
   agregar un lector al final, sin tocar la página. Y la página mide
   desde hoy aunque todavía no haya ninguna analítica conectada.

   Para conectar GA4 más adelante: hace falta banner de consentimiento
   (GA4 usa cookies), con "Rechazar" del mismo peso visual que "Aceptar",
   y el snippet cargando solo después de aceptar. Estos eventos propios
   se siguen registrando igual: lo que se bloquea es el envío a terceros.
   ══════════════════════════════════════════════════════════════════════ */
(function () {

  window.dataLayer = window.dataLayer || [];
  function track(evento, datos) {
    window.dataLayer.push(Object.assign({ event: evento, ts: Date.now() }, datos || {}));
  }

  /* ─── Atribución ───
     Primer toque en localStorage con ventana de 30 días (la misma que usan
     Meta y Google Ads). En tráfico pagado la gente ve el anuncio un día y
     compra dos días después: con sessionStorage se perdería el crédito del
     anuncio justo en el caso que más importa medir. */
  var CLAVE = '6g_primer_toque';
  var VENTANA = 30 * 24 * 60 * 60 * 1000;

  var visita = {};
  (function () {
    var q = new URLSearchParams(location.search);
    ['utm_source','utm_medium','utm_campaign','utm_content','utm_term',
     'gclid','fbclid','ttclid','msclkid'].forEach(function (k) { visita[k] = q.get(k) || ''; });
    visita.referrer = document.referrer || 'directo';
    visita.landing_path = location.pathname;
    visita.device = innerWidth <= 768 ? 'movil' : 'escritorio';   /* sin depender de matchMedia */
    visita.first_seen = new Date().toISOString();
  })();

  var atribucion = visita;
  try {
    var g = JSON.parse(localStorage.getItem(CLAVE) || 'null');
    if (g && g.d && Date.now() - g.t < VENTANA) atribucion = g.d;   // primer toque vigente: no se pisa
    else localStorage.setItem(CLAVE, JSON.stringify({ t: Date.now(), d: visita }));

    /* El origen de ESTA visita, para distinguirlo del primer toque. */
    if (!sessionStorage.getItem('6g_sesion')) {
      sessionStorage.setItem('6g_sesion', JSON.stringify({
        source: visita.utm_source, medium: visita.utm_medium, referrer: visita.referrer
      }));
    }
  } catch (e) { /* navegación privada o storage lleno: seguimos con esta visita */ }

  var origen = atribucion.utm_source || atribucion.referrer;

  /* Los mismos datos viajan en los campos ocultos del formulario. */
  Object.keys(atribucion).forEach(function (k) {
    var campo = document.querySelector('#form-pedido input[name="' + k + '"]');
    if (campo) campo.value = atribucion[k];
  });

  track('page_view', { primer_toque: origen, dispositivo: visita.device });

  /* ─── Verificación de edad ───
     Los tres eventos dicen algo que ningún otro dato cuenta: cuánta gente
     llega y se va en la puerta. Si age_gate_fail es alto, o el tráfico está
     mal segmentado o alguien está mintiendo por pereza. */
  var puerta = document.getElementById('edad');
  if (puerta && !document.documentElement.classList.contains('verificado')) {
    var si = document.getElementById('edad-si');
    track('age_gate_view', {});
    try { si.focus({ preventScroll: true }); } catch (e) {}

    si.addEventListener('click', function () {
      try { localStorage.setItem('6g_mayor_edad', 'si'); } catch (e) {}
      document.documentElement.classList.add('abierto');
      track('age_gate_pass', {});
    });

    document.getElementById('edad-no').addEventListener('click', function () {
      document.getElementById('edad-caja').classList.add('rechazado');
      track('age_gate_fail', {});
    });
  }

  /* ─── scroll_depth: ¿en qué punto abandonan? ─── */
  var hitos = [25, 50, 75, 100], vistos = {};
  addEventListener('scroll', function () {
    var doc = document.documentElement;
    var recorrible = doc.scrollHeight - innerHeight;
    var pct = recorrible > 0 ? (doc.scrollTop / recorrible) * 100 : 100;
    hitos.forEach(function (h) {
      if (pct >= h && !vistos[h]) { vistos[h] = 1; track('scroll_depth', { porcentaje: h }); }
    });
  }, { passive: true });

  /* ─── section_view: qué secciones se leen y cuáles se saltan ───
     Cuenta solo si la sección estuvo visible al menos un segundo. */
  var relojes = {};
  var obsSecciones = new IntersectionObserver(function (entradas) {
    entradas.forEach(function (e) {
      var nombre = e.target.dataset.seccion;
      if (e.isIntersecting) {
        relojes[nombre] = setTimeout(function () {
          track('section_view', { seccion: nombre });
          obsSecciones.unobserve(e.target);
        }, 1000);
      } else {
        clearTimeout(relojes[nombre]);
      }
    });
  }, { threshold: 0.01 });
  document.querySelectorAll('[data-seccion]').forEach(function (s) { obsSecciones.observe(s); });

  /* ─── cta_click con posición: la métrica más accionable de la página ───
     Si los clics salen del hero, la mitad de abajo sobra. Si salen del
     final, la página necesita ser larga. */
  document.querySelectorAll('[data-cta]').forEach(function (el) {
    el.addEventListener('click', function () {
      var destino = el.getAttribute('href') || '';
      var datos = {
        posicion: el.dataset.cta,
        texto: (el.textContent || '').trim().slice(0, 45),
        destino: destino,
        primer_toque: origen
      };
      track('cta_click', datos);
      if (/wa\.me|instagram\.com/.test(destino)) track('outbound_click', datos);
    });
  });

  /* ─── faq_open: cuál es la objeción real del mercado ─── */
  document.querySelectorAll('.faq-item').forEach(function (item) {
    item.addEventListener('toggle', function () {
      if (item.open) {
        track('faq_open', { pregunta: item.querySelector('summary').textContent.trim() });
      }
    });
  });

  /* ─── web_vitals: si la página es lenta en campo, no en tu máquina ─── */
  var vitales = { lcp: null, cls: 0, inp: null }, vitalesListos = false;

  [['largest-contentful-paint', function (e) { vitales.lcp = Math.round(e.startTime); }],
   ['layout-shift',            function (e) { if (!e.hadRecentInput) vitales.cls += e.value; }],
   ['event',                   function (e) {
      var d = Math.round(e.duration);
      if (vitales.inp === null || d > vitales.inp) vitales.inp = d;
   }]].forEach(function (par) {
    try {
      new PerformanceObserver(function (l) { l.getEntries().forEach(par[1]); })
        .observe({ type: par[0], buffered: true, durationThreshold: 40 });
    } catch (e) { /* el navegador no soporta esta métrica */ }
  });

  function reportarVitales() {
    if (vitalesListos) return;
    vitalesListos = true;
    track('web_vitals', {
      lcp_ms: vitales.lcp,
      cls: Math.round(vitales.cls * 1000) / 1000,
      inp_ms: vitales.inp
    });
  }

  /* ─── engaged_time: atención real, no pestañas abiertas y olvidadas ─── */
  var desde = Date.now(), acumulado = 0, ultimoReporte = 0;

  function reportarTiempo() {
    if (desde) { acumulado += Date.now() - desde; desde = 0; }
    var seg = Math.round(acumulado / 1000);
    if (seg > ultimoReporte) { ultimoReporte = seg; track('engaged_time', { segundos: seg }); }
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { reportarTiempo(); reportarVitales(); }
    else if (!desde) { desde = Date.now(); }
  });
  addEventListener('pagehide', function () { reportarTiempo(); reportarVitales(); });

  /* ══════════════════════════════════════════════════════════════════
     FORMULARIO
     ENDPOINT_FORMULARIO vacío = el pedido se cierra por WhatsApp con el
     mensaje ya armado (funciona hoy, sin backend). Al pegar una URL, el
     formulario pasa a enviar por fetch y muestra la confirmación en la
     página. Para Google Apps Script hace falta, además,
     mode:'no-cors' y Content-Type:'text/plain;charset=utf-8'.
     ══════════════════════════════════════════════════════════════════ */
  var ENDPOINT_FORMULARIO = '';
  var WA_NUMERO = '573506267136';

  var form = document.getElementById('form-pedido');
  if (form) {
    var btn  = document.getElementById('btn-envio');
    var ok   = document.getElementById('form-ok');
    var fail = document.getElementById('form-fail');
    var empezado = false;

    var marcar = function (id, hayError) {
      var c = document.getElementById(id);
      if (c) c.classList.toggle('error', hayError);
    };

    form.addEventListener('focusin', function () {
      if (!empezado) { empezado = true; track('form_start', { primer_toque: origen }); }
    });

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();

      var datos = {};
      new FormData(form).forEach(function (v, k) { datos[k] = v; });

      if (datos.website) { return; }   // honeypot con contenido = bot, se descarta sin avisar

      var errores = [];
      if (!datos.nombre || datos.nombre.trim().length < 2) errores.push('nombre');
      if (!datos.whatsapp || datos.whatsapp.replace(/\D/g, '').length < 7) errores.push('whatsapp');
      marcar('campo-nombre',   errores.indexOf('nombre') > -1);
      marcar('campo-whatsapp', errores.indexOf('whatsapp') > -1);

      if (errores.length) {
        track('form_field_error', { campos: errores.join(',') });
        return;
      }

      var textoBoton = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Enviando…';
      fail.classList.remove('visible');

      var restaurar = function () { btn.disabled = false; btn.textContent = textoBoton; };

      var exito = function () {
        track('generate_lead', {
          interes: datos.interes,
          posicion: 'formulario',
          primer_toque: origen,
          utm_campaign: atribucion.utm_campaign
        });
        form.querySelectorAll('input:not([type="hidden"]), textarea').forEach(function (c) { c.value = ''; });
        ok.textContent = '¡Listo, ' + datos.nombre.trim().split(' ')[0] +
                         '! Te escribimos por WhatsApp lo antes posible.';
        ok.classList.add('visible');
        restaurar();
      };

      if (ENDPOINT_FORMULARIO) {
        fetch(ENDPOINT_FORMULARIO, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(datos)
        }).then(function (r) {
          if (!r.ok) { throw new Error(r.status); }
          exito();
        }).catch(function () {
          fail.classList.add('visible');
          restaurar();
        });
      } else {
        var etiqueta = {
          six: 'un six pack', four: 'un four pack',
          recomendacion: 'una recomendación para empezar',
          volumen: 'cerveza para un negocio o un evento'
        }[datos.interes] || 'hacer un pedido';

        var mensaje = 'Hola 6Genes, soy ' + datos.nombre.trim() + ' y quiero ' + etiqueta + '.' +
                      (datos.mensaje ? ' ' + datos.mensaje.trim() : '');
        window.open('https://wa.me/' + WA_NUMERO + '?text=' + encodeURIComponent(mensaje), '_blank');
        exito();
      }
    });
  }

})();

/* ══════════════════════════════════════════════════════════════════════
   INTERACCIÓN Y ANIMACIÓN
   Va DESPUÉS de la medición a propósito: si algo de acá falla en algún
   navegador, la instrumentación ya quedó registrada y no se cae con él.
   ══════════════════════════════════════════════════════════════════════ */
  /* Menú móvil */
  const hamburger = document.getElementById('hamburger');
  const navLinks  = document.getElementById('nav-links');
  hamburger.addEventListener('click', () => navLinks.classList.toggle('open'));
  navLinks.querySelectorAll('a').forEach(a => a.addEventListener('click', () => navLinks.classList.remove('open')));

  /* Header compacto al bajar */
  window.addEventListener('scroll', () => {
    document.getElementById('navbar').style.padding = window.scrollY > 60 ? '.7rem 2.5rem' : '1.1rem 2.5rem';
  });

  /* Rotación de las fotos del hero */
  (function rotateHeroBg() {
    const slides = document.querySelectorAll('.hero-bg-slide');
    if (slides.length < 2) return;
    let current = 0;
    setInterval(() => {
      slides[current].classList.remove('active');
      current = (current + 1) % slides.length;
      slides[current].classList.add('active');
    }, 5000);
  })();

  /* Tira de bombillos */
  (function generateLights() {
    const container = document.getElementById('lights');
    const colors = ['#2EC4B6','#F7C948','#9B5DE5','#F97316','#EC4899','#DC2626'];
    const count  = Math.max(10, Math.floor(window.innerWidth / 55));
    for (let i = 0; i < count; i++) {
      const b = document.createElement('div');
      b.className = 'bulb';
      const c = colors[i % colors.length];
      b.style.cssText = `
        left:${(i / (count - 1)) * 100}%;
        background:${c};
        box-shadow:0 0 10px 3px ${c};
        animation-delay:${((i * 0.17) % 2).toFixed(2)}s;
        animation-duration:${(1.4 + (i % 4) * 0.4).toFixed(1)}s;
      `;
      container.appendChild(b);
    }
  })();

  /* Aparición al entrar en pantalla */
  const io = new IntersectionObserver(entries => {
    entries.forEach((e, i) => {
      if (e.isIntersecting) {
        setTimeout(() => e.target.classList.add('visible'), i * 60);
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.12 });

  document.querySelectorAll('.reveal').forEach(el => io.observe(el));

  /* Contadores animados (ABV, IBUs, stats) */
  function animateCount(el, target, suffix, duration = 1400) {
    const start = performance.now();
    function step(now) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.round(eased * target) + suffix;
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  const counterIO = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        const el = e.target;
        animateCount(el, parseInt(el.dataset.count, 10), el.dataset.suffix || '');
        counterIO.unobserve(el);
      }
    });
  }, { threshold: 0.4 });

  document.querySelectorAll('[data-count]').forEach(el => counterIO.observe(el));

  /* Inclinación 3D de las tarjetas */
  document.querySelectorAll('.beer-card').forEach(card => {
    card.addEventListener('mousemove', e => {
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top)  / r.height - 0.5;
      card.style.transform = `perspective(900px) translateY(-8px) rotateX(${(-y * 7).toFixed(2)}deg) rotateY(${(x * 7).toFixed(2)}deg)`;
    });
    card.addEventListener('mouseleave', () => {
      card.style.transition = 'transform .45s ease, box-shadow .3s';
      card.style.transform = 'perspective(900px) translateY(0) rotateX(0) rotateY(0)';
    });
    card.addEventListener('mouseenter', () => {
      card.style.transition = 'transform .1s ease, box-shadow .3s';
    });
  });