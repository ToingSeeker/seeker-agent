# SEEKER

[English](README.md) · **Bahasa Indonesia**

Agent coding di terminal. Bawaannya berjalan sepenuhnya lokal di atas [Ollama](https://ollama.com);
lewat `/model` bisa juga memakai server lokal lain atau model cloud. Node murni, tanpa build step.

```
seeker                       # sesi interaktif di folder ini
seeker "perbaiki bug login"  # langsung dengan pesan pertama
seeker -c                    # lanjutkan percakapan terakhir di folder ini
seeker -p "jelaskan repo"    # sekali jawab, bisa di-pipe
seeker --yolo                # tanpa tanya izin (perintah berbahaya tetap ditanyakan)
```

Di dalam sesi: `/init`, `/model`, `/resume`, `/config`, `/skills`, `/clear`, `/compact`, `/status`, `/think`, `/yolo`, `/help`, `/exit`, dan `!perintah`.
Ketik `/` untuk melihat saran perintah, Tab untuk melengkapi, Alt+Enter untuk baris baru, ↑↓ untuk riwayat pesan.

## Model dan penyedia

`/model` memilih tempat model dijalankan, lalu salah satu model yang didaftar penyedia itu saat itu juga:

| Jenis | Penyedia |
| --- | --- |
| Lokal | Ollama, LM Studio, llama.cpp server |
| Lewat Claude Code | **Claude Code** — Claude Code yang sudah login di mesinmu bekerja sebagai agent penuh dengan tool-nya sendiri (Read, Edit, Bash, …), tanpa kunci API. SEEKER menampilkan aktivitasnya dan menanyakan izin sebelum edit atau perintah dijalankan |
| Cloud | Anthropic (Claude), OpenAI, Google Gemini, xAI Grok, DeepSeek, Mistral, Moonshot Kimi, Groq, Cerebras, Together AI, Fireworks AI, OpenRouter |
| Buatan sendiri | endpoint apa pun yang kompatibel dengan OpenAI — tambahkan `"providers": { "nama": { "baseUrl": "https://…/v1" } }` di config |

Kunci API diketik lewat `/key` (tersimpan di `~/.seeker/config.json`, hanya bisa dibaca pemilik) atau diambil dari
variabel lingkungan (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, …). Dari baris perintah:
`seeker --provider openai -m <model>`.

Dengan penyedia cloud, pesanmu dan isi file yang dibaca SEEKER dikirim ke server penyedia itu; header berubah
dari `LOCAL • PRIVATE` menjadi `CLOUD • <NAMA>`.

## Instruksi dan memori

- `~/.seeker/SEEKER.md` — aturan kerja yang berlaku di semua proyek.
- `~/.seeker/memory/` — catatan dari sesi-sesi sebelumnya; `MEMORY.md` adalah indeksnya (satu baris per catatan).
- `~/.seeker/memory/projects/<folder>/` — catatan khusus satu proyek, dimuat saat SEEKER dijalankan di folder itu.

Yang masuk ke system prompt hanya indeksnya, paling banyak 20% dari context window. Kalau indeks tidak muat (model lokal
dengan konteks kecil), SEEKER diberi tahu letak file indeksnya dan mencarinya dengan grep saat perlu.

## Remote control dari HP

`seeker remote` menjalankan agent di Mac dan menghubungkannya ke relay (`remote-server/`, di-deploy ke Railway).
HP membuka aplikasi web di alamat relay itu.

```
seeker remote --setup        # menampilkan variabel untuk relay dan link pairing untuk HP
seeker remote --url https://<alamat-relay>
seeker remote ~/proyek-a ~/proyek-b   # mulai; tanpa argumen memakai folder saat ini
```

- Mac hanya membuat koneksi keluar; tidak ada port yang dibuka.
- Isi percakapan dan perintah dienkripsi antara HP dan Mac (AES-256-GCM). Relay hanya menyimpan hash token akses
  (`SEEKER_REMOTE_AUTH`) dan tidak bisa membaca atau memalsukan apa pun.
- Edit dan perintah selalu minta persetujuan di HP; mode tanpa izin tidak tersedia lewat remote.
- Relay tidak menyimpan apa pun ke disk; setelah restart, Mac mengirim ulang keadaannya.
- Token yang salah dikunci per alamat. Di Railway alamat pemanggil dibaca dari `x-forwarded-for`; di belakang
  proxy lain yang mengisi header itu sendiri, setel `SEEKER_TRUST_PROXY=1`. Tanpa proxy, biarkan kosong.
- Notifikasi push (persetujuan, pertanyaan dari model, tugas selesai) dikirim langsung dari Mac ke layanan push HP
  dengan enkripsi Web Push (`src/webpush.mjs`); relay tidak terlibat. Nyalakan di Settings aplikasi HP.
  Di iPhone, aplikasinya harus dipasang dulu lewat Share → Add to Home Screen.
- Dari HP juga bisa: ganti model (ketuk nama model), dan menjawab pertanyaan yang diajukan model.

## Pasang

Butuh Node ≥ 22 dan Ollama dengan model yang mendukung tool calling.

```
git clone https://github.com/ToingSeeker/seeker-agent.git
cd seeker-agent
npm install          # untuk Claude: SDK Anthropic dan Claude Agent SDK (binary bawaan dilewati, lihat .npmrc)
npm link             # memasang perintah `seeker`
ollama pull qwen3.5:27b
```

## Cara kerja

| File | Isi |
| --- | --- |
| `src/cli.mjs` | argumen, startup, loop interaktif |
| `src/agent.mjs` | loop agent: model → tool → hasil → model, plus perangkuman konteks |
| `src/tools.mjs` | `read_file` `write_file` `edit_file` `bash` (juga latar belakang) `process_output` `process_stop` `glob` `grep` `list_dir` `web_fetch` `web_search` `ask_user` `task` `skill` `todo_write` |
| `src/remote.mjs`, `remote-server/` | remote control: daemon di Mac, relay + aplikasi web HP |
| `src/mcp.mjs` | server MCP: tool tambahan (`mcp__<server>__<tool>`) dari `mcpServers` di config atau `.seeker/mcp.json`; atur lewat `/mcp`. Server yang didefinisikan file proyek tidak dijalankan sebelum kamu setujui di `/mcp` |
| `src/permissions.mjs` | baca bebas; edit, shell, dan jaringan minta izin |
| `src/prompt.mjs` | system prompt + instruksi proyek (`SEEKER.md`, lalu `AGENTS.md`, lalu `CLAUDE.md`) |
| `src/providers.mjs` | daftar penyedia + adapter: Ollama, OpenAI-compatible, Anthropic (SDK) |
| `src/claude-code.mjs`, `src/external-tools.mjs` | penyedia Claude Code lewat Claude Agent SDK; tampilan dan klasifikasi izin untuk tool miliknya |
| `src/ollama.mjs`, `src/http.mjs` | client streaming Ollama dan HTTP dasar |
| `src/skills.mjs` | skill: `~/.seeker/skills/<nama>/SKILL.md`, `.seeker/skills/<nama>/SKILL.md`, dan skill plugin `~/.seeker/plugins/<plugin>/skills/…` yang dipanggil sebagai `/plugin:nama` |
| `src/ui.mjs`, `src/markdown.mjs` | tampilan: header, panel, pohon langkah tool, status bar |
| `src/screen.mjs` | tata letak layar penuh: header menempel di atas, kotak input di bawah, percakapan di tengah (baris lama masuk scrollback terminal) |
| `src/text.mjs` | ukur dan bungkus teks berwarna (ANSI, karakter lebar) |
| `src/input.mjs` | editor input (raw key press, riwayat, paste) |
| `src/menu.mjs` | menu `/config` dan pemilih `/model`, `/resume` |

Pengaturan disimpan di `~/.seeker/config.json` (`model`, `numCtx`, `think`, `showThinking`, `host`),
riwayat percakapan di `~/.seeker/sessions/`. Catatan yang berlaku di semua proyek: `~/.seeker/SEEKER.md`.

## Tes

Saat mencoba secara manual, pakai `SEEKER_HOME=/tmp/folder-uji seeker` supaya konfigurasi dan riwayat aslimu tidak ikut berubah.

```
npm test
```

## Ikut mengembangkan

Lihat [CONTRIBUTING.md](CONTRIBUTING.md). Celah keamanan dilaporkan secara tertutup, lihat [SECURITY.md](SECURITY.md).

## Lisensi

[MIT](LICENSE)
