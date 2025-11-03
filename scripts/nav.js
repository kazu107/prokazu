(function () {
    function initMenu() {
        const toggle = document.querySelector('[data-menu-toggle]');
        const menu = document.querySelector('[data-menu]');
        if (!toggle || !menu) return;

        let open = false;

        const setState = (nextOpen) => {
            open = Boolean(nextOpen);
            toggle.setAttribute('aria-expanded', String(open));
            menu.hidden = !open;
        };

        const closeMenu = () => setState(false);
        const openMenu = () => setState(true);

        setState(false);

        toggle.addEventListener('click', () => {
            if (open) {
                closeMenu();
            } else {
                openMenu();
            }
        });

        document.addEventListener('click', (event) => {
            if (!open) return;
            const target = event.target;
            if (target instanceof Node && (menu.contains(target) || toggle.contains(target))) {
                return;
            }
            closeMenu();
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && open) {
                closeMenu();
                toggle.focus();
            }
        });

        window.addEventListener('resize', () => {
            if (open && window.innerWidth > 1024) {
                closeMenu();
            }
        });

        const currentPath = (window.location.pathname || '/').replace(/\\/g, '/');
        const normalizedPath = currentPath.endsWith('/') ? currentPath.slice(0, -1) || '/' : currentPath;
        const isBattle = normalizedPath.toLowerCase().endsWith('/battle.html');
        const isRoot = normalizedPath === '/' || normalizedPath.toLowerCase().endsWith('/index.html');

        menu.querySelectorAll('[data-menu-link]').forEach((link) => {
            if (!(link instanceof HTMLAnchorElement)) return;
            const targetKey = (link.dataset.menuLink || '').toLowerCase();
            const shouldHighlight =
                (targetKey === 'battle' && isBattle) ||
                (targetKey === 'problem' && !isBattle && isRoot);
            if (shouldHighlight) {
                link.classList.add('active');
            } else {
                link.classList.remove('active');
            }
            link.addEventListener('click', () => {
                closeMenu();
            });
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initMenu);
    } else {
        initMenu();
    }
}());
