const CONFIG = {
  // *** IMPORTANTE: REEMPLAZAR CON LA DIRECCIÓN DEL NUEVO CONTRATO ENOCV2 ***
  enocAddress: "0xab8DF9213d13a3cDe984A83129e6acDaCBA78633", 
  usdtAddress: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
  routerAddress: "0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff", // QuickSwap Router
  polygonRpc: "https://polygon-rpc.com", // WalletConnect RPC
  desiredChainId: 137 // Polygon mainnet chainId
};

// minimal router ABI for swapExactTokensForTokens
const routerABI = [
  {"inputs":[{"internalType":"uint256","name":"amountIn","type":"uint256"},{"internalType":"uint256","name":"amountOutMin","type":"uint256"},{"internalType":"address[]","name":"path","type":"address[]"},{"internalType":"address","name":"to","type":"address"},{"internalType":"uint256","name":"deadline","type":"uint256"}],"name":"swapExactTokensForTokens","outputs":[{"internalType":"uint256[]","name":"amounts","type":"uint256[]"}],"stateMutability":"nonpayable","type":"function"}
];

// minimal ERC20 approve and balanceOf ABI
const erc20ABI = [
  {"constant":false,"inputs":[{"name":"spender","type":"address"},{"name":"value","type":"uint256"}],"name":"approve","outputs":[{"name":"","type":"bool"}],"type":"function"},
  {"constant":true,"inputs":[{"name":"owner","type":"address"}],"name":"balanceOf","outputs":[{"name":"balance","type":"uint256"}],"type":"function"}
];

// UI references
const btnConnect = document.getElementById("btnConnect");
const btnDisconnect = document.getElementById("btnDisconnect");
const connectedPanel = document.getElementById("connectedPanel");
const accountEl = document.getElementById("account");
const chainEl = document.getElementById("chain");
const statusText = document.getElementById("statusText");
const btnBuy = document.getElementById("btnBuy");

let web3Modal, providerInstance, web3, currentAccount;

// Init Web3Modal
function initWeb3Modal() {
  const providerOptions = {
    // Definimos WalletConnect como una opción explícita
    walletconnect: {
      package: window.WalletConnectProvider.default,
      options: {
        rpc: {
          137: CONFIG.polygonRpc
        },
        chainId: CONFIG.desiredChainId
      }
    }
    // Web3Modal automáticamente agregará opciones para billeteras inyectadas (MetaMask)
  };

  web3Modal = new window.Web3Modal.default({
    cacheProvider: false,
    providerOptions,
    // La opción 'disableInjectedProvider' a menudo ayuda a forzar el modal en móviles
    disableInjectedProvider: false
  });
}

// utilities
function setStatus(msg) { statusText.innerText = msg; }
function showConnected(address, chainId) {
  connectedPanel.style.display = "block";
  accountEl.innerText = address;
  chainEl.innerText = chainId;
  document.getElementById("notConnectedPanel").style.display = "none";
  btnDisconnect.style.display = "inline-block";
  btnConnect.style.display = "none";
}

// connect (universal)
async function connectWallet() {
  try {
    setStatus("Abriendo el selector de Wallet...");
    
    // Abrir el modal que permite elegir la billetera (incluyendo WalletConnect QR)
    providerInstance = await web3Modal.connect();
    
    // Si la conexión es exitosa, el resto del código es el mismo:
    web3 = new Web3(providerInstance);
    const accounts = await web3.eth.getAccounts();
    currentAccount = accounts[0];
    let chainId = await web3.eth.getChainId();
    showConnected(currentAccount, chainId);
    setStatus("Conectado en chain " + chainId);

    // Eventos para cambios de cuenta/cadena
    if (providerInstance.on) {
      providerInstance.on("accountsChanged", (accounts) => {
        currentAccount = accounts[0];
        accountEl.innerText = currentAccount;
      });
      providerInstance.on("chainChanged", (chainIdHex) => {
        const normalized = (typeof chainIdHex === "string" && chainIdHex.startsWith("0x")) ? parseInt(chainIdHex, 16) : Number(chainIdHex);
        chainEl.innerText = normalized;
        if (normalized !== CONFIG.desiredChainId) {
          setStatus("Cambio de red detectado. Cambia a Polygon (chainId 137).");
        } else {
          setStatus("Red Polygon detectada.");
        }
      });
      providerInstance.on("disconnect", (code, reason) => {
        disconnectWallet();
      });
    }

    if (Number(await web3.eth.getChainId()) !== CONFIG.desiredChainId) {
      setStatus("Por favor cambie la red a Polygon (137) en su wallet.");
    } else {
      setStatus("Listo. Puedes comprar ENOC.");
    }

  } catch (err) {
    console.error("connectWallet error", err);
    setStatus("No se pudo conectar la wallet. Intenta usar el Navegador DApp de tu billetera.");
  }
}

async function disconnectWallet() {
  try {
    if (providerInstance && providerInstance.close) {
      // Para WalletConnect
      await providerInstance.close();
    }
    // Para billeteras inyectadas (MetaMask)
    await web3Modal.clearCachedProvider();
  } catch (e) { /* ignore */ }
  currentAccount = null;
  web3 = null;
  providerInstance = null;
  connectedPanel.style.display = "none";
  document.getElementById("notConnectedPanel").style.display = "block";
  btnConnect.style.display = "inline-block";
  btnDisconnect.style.display = "none";
  setStatus("Desconectado");
}

// BUY function (USDT -> ENOC) - Directly interacts with QuickSwap Router
async function buyENOC() {
  if (!web3 || !currentAccount) {
    alert("Conecta tu wallet primero.");
    return;
  }

  const raw = document.getElementById("amountUSDT").value;
  if (!raw || isNaN(raw) || Number(raw) <= 0) {
    alert("Ingresa una cantidad válida.");
    return;
  }

  const amountUSDT = raw.toString();
  setStatus("Preparando transacción...");

  try {
    const router = new web3.eth.Contract(routerABI, CONFIG.routerAddress);
    const usdt = new web3.eth.Contract(erc20ABI, CONFIG.usdtAddress);

    const amountIn = web3.utils.toWei(amountUSDT, "mwei"); 

    // --- 1. APROBACIÓN ---
    setStatus("Solicitando aprobación USDT...");
    const approveTx = await usdt.methods.approve(CONFIG.routerAddress, amountIn).send({ from: currentAccount });
    setStatus("Aprobación confirmada. Ejecutando swap...");

    const deadline = Math.floor(Date.now() / 1000) + 120; // 2 minutos

    // --- 2. SWAP ---
    const swapTx = await router.methods.swapExactTokensForTokens(
      amountIn,
      0, // amountOutMin = 0 (usar un slippage real en producción)
      [CONFIG.usdtAddress, CONFIG.enocAddress],
      currentAccount,
      deadline
    ).send({ from: currentAccount });

    console.log("swapTx", swapTx);
    setStatus("Swap realizado. Revisa tu wallet.");
  } catch (err) {
    console.error("buyENOC error", err);
    setStatus("Error en la transacción. El error puede ser por límites anti-ballena o falta de MATIC para gas.");
    alert("Error: La transacción ha fallado. Revisa los límites de ENOCv2 o tu saldo de MATIC: " + (err.message || err));
  }
}

// wire UI
btnConnect.addEventListener("click", connectWallet);
btnDisconnect.addEventListener("click", disconnectWallet);
btnBuy.addEventListener("click", buyENOC);

// initialize
initWeb3Modal();

setStatus("Listo. Pulsa 'Conectar Wallet' para empezar.");
