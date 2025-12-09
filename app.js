// app.js (module) — Web3Modal v2 + WalletConnect v2 + ethers.js (v5)
// Pega exactamente este archivo en tu repo (root). index.html ya lo carga como módulo.

import { Web3Modal } from "https://unpkg.com/@web3modal/html@2.6.0/dist/index.js";
import { EthereumClient, w3mConnectors, w3mProvider } from "https://unpkg.com/@web3modal/ethereum@2.5.0/dist/index.js";
import { ethers } from "https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.esm.min.js";

// --- CONFIG
const PROJECT_ID = "80465b85478aa291bb30b4b3346b4b66"; // tu Project ID (WalletConnect v2)
const CONFIG = {
  enocAddress: "0xab8DF9213d13a3cDe984A83129e6acDaCBA78633",
  usdtAddress:  "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
  routerAddress:"0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff", // QuickSwap router
  polygonRpc:   "https://polygon-rpc.com",
  chainId: 137
};

// minimal ABIs
const routerABI = [{"inputs":[{"internalType":"uint256","name":"amountIn","type":"uint256"},{"internalType":"uint256","name":"amountOutMin","type":"uint256"},{"internalType":"address[]","name":"path","type":"address[]"},{"internalType":"address","name":"to","type":"address"},{"internalType":"uint256","name":"deadline","type":"uint256"}],"name":"swapExactTokensForTokens","outputs":[{"internalType":"uint256[]","name":"amounts","type":"uint256[]"}],"stateMutability":"nonpayable","type":"function"}];
const erc20ABI = [{"constant":false,"inputs":[{"name":"spender","type":"address"},{"name":"value","type":"uint256"}],"name":"approve","outputs":[{"name":"","type":"bool"}],"type":"function"},{"constant":true,"inputs":[{"name":"owner","type":"address"}],"name":"balanceOf","outputs":[{"name":"balance","type":"uint256"}],"type":"function"}];

// UI elements
const btnConnect = document.getElementById("btnConnect");
const btnDisconnect = document.getElementById("btnDisconnect");
const connectedPanel = document.getElementById("connectedPanel");
const notConnectedPanel = document.getElementById("notConnectedPanel");
const accountEl = document.getElementById("account");
const chainEl = document.getElementById("chain");
const statusText = document.getElementById("statusText");
const btnBuy = document.getElementById("btnBuy");
const amountInput = document.getElementById("amountUSDT");

let web3Modal, ethereumClient, provider, signer, address;

// --- Inicializar Web3Modal v2 + EthereumClient (wagmi-less usage via web3modal/ethereum)
function initModal() {
  // conectar proveedores (WalletConnect v2)
  const projectId = PROJECT_ID;
  const chains = [CONFIG.chainId];

  // Creators from web3modal/ethereum
  const providerOptions = w3mProvider({ projectId, chains });
  const connectors = w3mConnectors({ projectId, chains });

  web3Modal = new Web3Modal({
    projectId,
    themeMode: "light",
    accentColor: "violet",
    // aqui no hay 'ethereumClient' param en esta version de html; instanciamos EthereumClient
  });

  ethereumClient = new EthereumClient({ projectId, chains }, web3Modal); // wrapper helper
}

// helper: set status
function setStatus(msg) {
  statusText.innerText = msg;
}

// mostrar UI conectado
function showConnected(addr, chainId) {
  connectedPanel.style.display = "block";
  notConnectedPanel.style.display = "none";
  accountEl.innerText = addr;
  chainEl.innerText = chainId;
  btnDisconnect.style.display = "inline-block";
  btnConnect.style.display = "none";
}

// conectar wallet (abre modal web3modal)
async function connectWallet() {
  try {
    setStatus("Abriendo modal de conexión...");
    // Abre modal nativo; devuelve provider WalletConnect/vital
    provider = await web3Modal.connect();
    // provider es un provider compatible EIP-1193
    // creamos un ethers provider
    const ethersProvider = new ethers.providers.Web3Provider(provider);
    signer = ethersProvider.getSigner();
    address = await signer.getAddress();
    const network = await ethersProvider.getNetwork();

    showConnected(address, network.chainId);
    setStatus("Conectado en chain " + network.chainId);

    // eventos
    if (provider.on) {
      provider.on("accountsChanged", (accounts) => {
        if (accounts && accounts[0]) {
          address = accounts[0];
          accountEl.innerText = address;
        }
      });
      provider.on("chainChanged", (chainIdHex) => {
        const normalized = (typeof chainIdHex === "string" && chainIdHex.startsWith("0x")) ? parseInt(chainIdHex, 16) : Number(chainIdHex);
        chainEl.innerText = normalized;
        if (normalized !== CONFIG.chainId) setStatus("Por favor cambia a la red Polygon (137) en tu wallet.");
        else setStatus("Red Polygon detectada.");
      });
      provider.on("disconnect", (code, reason) => {
        disconnect();
      });
    }

    // check chain
    if ((await signer.provider.getNetwork()).chainId !== CONFIG.chainId) {
      setStatus("Por favor, cambia la red a Polygon (137) en tu wallet.");
    } else {
      setStatus("Listo. Puedes comprar ENOC.");
    }
  } catch (err) {
    console.error("connectWallet err", err);
    setStatus("No se pudo conectar la wallet.");
    alert("Error: " + (err.message || err));
  }
}

// desconectar
async function disconnect() {
  try { if (provider && provider.disconnect) await provider.disconnect(); } catch (e) {}
  provider = null; signer = null; address = null;
  connectedPanel.style.display = "none";
  notConnectedPanel.style.display = "block";
  btnDisconnect.style.display = "none";
  btnConnect.style.display = "inline-block";
  setStatus("Desconectado");
}

// función de compra: USDT -> ENOC (usa signer)
async function buyENOC() {
  if (!signer || !address) { alert("Conecta la wallet primero."); return; }

  const raw = amountInput.value;
  if (!raw || isNaN(raw) || Number(raw) <= 0) { alert("Ingresa un monto válido."); return; }

  const usdtAmount = raw.toString();
  setStatus("Preparando transacción...");

  try {
    const ethersProvider = signer.provider;
    const routerContract = new ethers.Contract(CONFIG.routerAddress, routerABI, signer);
    const usdtContract = new ethers.Contract(CONFIG.usdtAddress, erc20ABI, signer);

    // Convertir a 6 decimales (USDT)
    const amountIn = ethers.utils.parseUnits(usdtAmount, 6); // USDT 6 decs

    // 1) Aprobar el router
    setStatus("Solicitando aprobación de USDT...");
    const approveTx = await usdtContract.approve(CONFIG.routerAddress, amountIn);
    await approveTx.wait(1);

    // 2) Ejecutar swap (deadline 2 min adelante)
    setStatus("Ejecutando swap...");
    const deadline = Math.floor(Date.now()/1000) + 120;

    const tx = await routerContract.swapExactTokensForTokens(
      amountIn,
      0, // amountOutMin = 0 (demo) -> en producción deberías calcular mínimo aceptable para protección
      [CONFIG.usdtAddress, CONFIG.enocAddress],
      address,
      deadline,
      { gasLimit: 800000 }
    );

    setStatus("Transacción enviada, esperando confirmación...");
    await tx.wait(1);
    setStatus("Swap confirmado. Revisa tu wallet.");
    alert("Compra realizada. Revisa tu wallet en Polygon.");
  } catch (err) {
    console.error("buyENOC err", err);
    setStatus("Error en la transacción.");
    alert("Error: " + (err.message || err));
  }
}

// wiring y arranque
initModal();
document.getElementById("btnConnect").addEventListener("click", connectWallet);
document.getElementById("btnDisconnect").addEventListener("click", disconnect);
document.getElementById("btnBuy").addEventListener("click", buyENOC);
setStatus("Listo. Pulsa 'Conectar Wallet' para iniciar.");
