# Lâmpada

App Android open source (React Native + Expo) que controla lâmpadas Tuya, como as do app **Elgin Smart** e do **Smart Life**, **direto pelo Wi-Fi de casa**, sem nuvem e sem servidor.

- Liga e desliga, brilho, branco quente ou frio, cor e saturação
- Conexão TCP persistente com a lâmpada (protocolo local Tuya **3.3**): cerca de 40 a 200 ms por comando
- A tela muda na hora (atualização otimista), e o comando segue em seguida
- A chave local fica guardada só no celular (`expo-secure-store`); nada sensível vai para o repositório nem para o APK

## Instalar
1. Baixe o APK mais recente em **[Releases](../../releases)** e instale. O Android vai pedir para permitir a instalação de fontes desconhecidas.
2. Na primeira abertura, informe o **ID**, o **IP** e a **chave local** da lâmpada (veja abaixo). O app testa a conexão antes de salvar.

## Obter ID, IP e chave local (feito uma vez)
1. Crie um projeto em [platform.tuya.com](https://platform.tuya.com) (Cloud → Create Cloud Project, Smart Home, data center **Western America** para contas do Brasil).
2. Em **Devices → Link App Account**, leia o QR code com o **Smart Life** (aba Eu → ícone de leitura).
3. No PC, no mesmo Wi-Fi da lâmpada:
   ```bash
   pip install tinytuya
   python -m tinytuya wizard
   ```
   O `devices.json` gerado traz o `id`, o `ip` e a `key` (chave local). Não publique esse arquivo.

Reserve um IP fixo para a lâmpada no roteador. Se você parear a lâmpada de novo no app, a chave muda: gere outra com o `wizard`.

## Desenvolvimento
```bash
pnpm install
pnpm exec tsc --noEmit
node scripts/testar-lampada.mjs caminho/devices.json   # testa o protocolo contra a lâmpada real (liga/desliga 3x)
```
- `src/tuya.ts`: protocolo Tuya 3.3 (AES-128-ECB, CRC32, frames 0x55AA), sem dependência de plataforma
- `App.tsx`: tela de controle; `src/Settings.tsx`: configuração da lâmpada
- O socket TCP usa `react-native-tcp-socket`, por isso o app **não roda no Expo Go**: é preciso gerar o APK.

## Build
Cada push na `main` dispara o GitHub Actions (`.github/workflows/apk.yml`), que gera o APK `v0.0.<build>` e o publica em Releases. A assinatura usa os secrets `KEYSTORE_BASE64` e `KEYSTORE_PASSWORD` (keystore PKCS12, alias `lampada`), o que permite atualizar o app sem desinstalar.

Suporte atual: lâmpadas Tuya versão **3.3** com DPs 20–24 (tipo B). Versões 3.4 e 3.5 do protocolo ainda não são suportadas.

## Licença
MIT
