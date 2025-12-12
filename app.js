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
    walletconnect: {
      package: window.WalletConnectProvider.default,
      options: {
        rpc: {
          137: CONFIG.polygonRpc
        },
        chainId: CONFIG.desiredChainId
      }
    }
  };

  web3Modal = new window.Web3Modal.default({
    cacheProvider: false,
    providerOptions
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
    setStatus("Conectando wallet...");
    // open modal (handles injected wallets and walletconnect)
    providerInstance = await web3Modal.connect();
    // create web3 instance
    web3 = new Web3(providerInstance);
    // get accounts
    const accounts = await web3.eth.getAccounts();
    currentAccount = accounts[0];
    // chain id as number
    let chainId = await web3.eth.getChainId();
    showConnected(currentAccount, chainId);
    setStatus("Conectado en chain " + chainId);

    // events for accounts/chain changes
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

    // check network
    if (Number(await web3.eth.getChainId()) !== CONFIG.desiredChainId) {
      setStatus("Por favor cambie la red a Polygon (137) en su wallet.");
    } else {
      setStatus("Listo. Puedes comprar ENOC.");
    }

  } catch (err) {
    console.error("connectWallet error", err);
    setStatus("No se pudo conectar la wallet.");
  }
}

async function disconnectWallet() {
  try {
    if (providerInstance && providerInstance.close) {
      await providerInstance.close();
    }
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
    // router & contracts
    const router = new web3.eth.Contract(routerABI, CONFIG.routerAddress);
    const usdt = new web3.eth.Contract(erc20ABI, CONFIG.usdtAddress);

    // Convert USDT to 6-decimals format (USDT on Polygon uses 6 decimals)
    const amountIn = web3.utils.toWei(amountUSDT, "mwei"); 

    // Approve router to spend USDT
    setStatus("Solicitando aprobación USDT...");
    const approveTx = await usdt.methods.approve(CONFIG.routerAddress, amountIn).send({ from: currentAccount });
    setStatus("Aprobación confirmada. Ejecutando swap...");

    // Deadline 2 minutes ahead
    const deadline = Math.floor(Date.now() / 1000) + 120;

    // Swap: USDT -> ENOC
    // amountOutMin set to 0 for demo (NOT recommended in production, usar Price Feeds)
    const swapTx = await router.methods.swapExactTokensForTokens(
      amountIn,
      0,
      [CONFIG.usdtAddress, CONFIG.enocAddress],
      currentAccount,
      deadline
    ).send({ from: currentAccount });

    console.log("swapTx", swapTx);
    setStatus("Swap realizado. Revisa tu wallet.");
  } catch (err) {
    console.error("buyENOC error", err);
    // Este mensaje de error cubre los errores de gas, y también los errores de los límites del nuevo Contrato ENOCv2.
    setStatus("Error en la transacción. La compra/venta puede exceder los límites anti-ballena del contrato.");
    alert("Error: La transacción ha fallado. Esto puede deberse a que excede los límites de compra/holding del Contrato Anti-Ballena, o a un error de gas: " + (err.message || err));
  }
}

// wire UI
btnConnect.addEventListener("click", connectWallet);
btnDisconnect.addEventListener("click", disconnectWallet);
btnBuy.addEventListener("click", buyENOC);

// initialize
initWeb3Modal();

setStatus("Listo. Pulsa 'Conectar Wallet' para empezar.");
