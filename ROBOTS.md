# Robots.txt Analysis — TEC Agency (wearetec.com)

Sursa: https://wearetec.com/robots.txt

## Reguli

```
User-agent: *
Allow: /
Disallow: /wp-admin/
Allow: /wp-admin/admin-ajax.php
```

## Interpretare

| Cale | Accesibil? | Ce conține |
|---|---|---|
| `/` | ✅ Da | Pagina principală |
| `/careers/` | ✅ Da | Pagina de cariere |
| `/wp-admin/` | ❌ **Disallowed** | Zona administrativă WordPress |

## Recomandare

robots.txt NU este legal binding, dar reprezintă intenția proprietarului site-ului.

- API-ul BambooHR (`https://tecss.bamboohr.com/careers/list`) este un subdomeniu extern și nu intră sub incidența robots.txt de pe wearetec.com
- Scraperul face o singură cerere către API cu delay rezonabil — comportament politicos, nu agresiv

**Concluzie**: Risc minim. API-ul BambooHR este public și răspunde fără autentificare.
