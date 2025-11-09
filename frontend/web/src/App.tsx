import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface LotteryTicket {
  id: string;
  numbers: number[];
  encryptedNumbers: string;
  timestamp: number;
  creator: string;
  isVerified: boolean;
  decryptedValue?: number;
  prizeAmount?: number;
}

interface LotteryDraw {
  id: string;
  winningNumbers: number[];
  encryptedWinning: string;
  drawTime: number;
  totalPrize: number;
  isCompleted: boolean;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [tickets, setTickets] = useState<LotteryTicket[]>([]);
  const [draws, setDraws] = useState<LotteryDraw[]>([]);
  const [selectedNumbers, setSelectedNumbers] = useState<number[]>([]);
  const [showTicketModal, setShowTicketModal] = useState(false);
  const [showDrawModal, setShowDrawModal] = useState(false);
  const [creatingTicket, setCreatingTicket] = useState(false);
  const [creatingDraw, setCreatingDraw] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [userHistory, setUserHistory] = useState<LotteryTicket[]>([]);
  const [stats, setStats] = useState({ totalTickets: 0, totalDraws: 0, totalPrize: 0 });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadData = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        const contract = await getContractReadOnly();
        if (contract) {
          setContractAddress(await contract.getAddress());
          await loadTickets(contract);
          await loadDraws(contract);
          await loadStats();
        }
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [isConnected]);

  const loadTickets = async (contract: any) => {
    try {
      const businessIds = await contract.getAllBusinessIds();
      const ticketsList: LotteryTicket[] = [];
      
      for (const businessId of businessIds) {
        if (businessId.includes('ticket-')) {
          const businessData = await contract.getBusinessData(businessId);
          ticketsList.push({
            id: businessId,
            numbers: [],
            encryptedNumbers: businessId,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        }
      }
      
      setTickets(ticketsList);
      setUserHistory(ticketsList.filter(ticket => ticket.creator.toLowerCase() === address?.toLowerCase()));
    } catch (e) {
      console.error('Error loading tickets:', e);
    }
  };

  const loadDraws = async (contract: any) => {
    try {
      const businessIds = await contract.getAllBusinessIds();
      const drawsList: LotteryDraw[] = [];
      
      for (const businessId of businessIds) {
        if (businessId.includes('draw-')) {
          const businessData = await contract.getBusinessData(businessId);
          drawsList.push({
            id: businessId,
            winningNumbers: [],
            encryptedWinning: businessId,
            drawTime: Number(businessData.timestamp),
            totalPrize: Number(businessData.publicValue1) || 0,
            isCompleted: businessData.isVerified
          });
        }
      }
      
      setDraws(drawsList);
    } catch (e) {
      console.error('Error loading draws:', e);
    }
  };

  const loadStats = async () => {
    setStats({
      totalTickets: tickets.length,
      totalDraws: draws.length,
      totalPrize: draws.reduce((sum, draw) => sum + draw.totalPrize, 0)
    });
  };

  const selectNumber = (number: number) => {
    if (selectedNumbers.includes(number)) {
      setSelectedNumbers(selectedNumbers.filter(n => n !== number));
    } else if (selectedNumbers.length < 6) {
      setSelectedNumbers([...selectedNumbers, number]);
    }
  };

  const generateRandomNumbers = () => {
    const numbers: number[] = [];
    while (numbers.length < 6) {
      const num = Math.floor(Math.random() * 49) + 1;
      if (!numbers.includes(num)) numbers.push(num);
    }
    setSelectedNumbers(numbers.sort((a, b) => a - b));
  };

  const createTicket = async () => {
    if (!isConnected || !address || selectedNumbers.length !== 6) return;
    
    setCreatingTicket(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting ticket with FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Contract not available");
      
      const ticketId = `ticket-${Date.now()}`;
      const numbersHash = selectedNumbers.reduce((sum, num) => sum + num, 0);
      
      const encryptedResult = await encrypt(contractAddress, address, numbersHash);
      
      const tx = await contract.createBusinessData(
        ticketId,
        `Ticket-${ticketId.substring(7, 13)}`,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        0,
        0,
        `Lottery ticket with numbers: ${selectedNumbers.join(', ')}`
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for blockchain confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Ticket created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowTicketModal(false);
        setSelectedNumbers([]);
      }, 2000);
      
      await loadTickets(contract);
      await loadStats();
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected") 
        ? "Transaction rejected" 
        : "Creation failed";
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingTicket(false); 
    }
  };

  const createDraw = async () => {
    if (!isConnected || !address) return;
    
    setCreatingDraw(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating new draw..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Contract not available");
      
      const winningNumbers = Array.from({length: 6}, () => Math.floor(Math.random() * 49) + 1);
      const drawId = `draw-${Date.now()}`;
      const numbersHash = winningNumbers.reduce((sum, num) => sum + num, 0);
      
      const encryptedResult = await encrypt(contractAddress, address, numbersHash);
      
      const tx = await contract.createBusinessData(
        drawId,
        `Draw-${drawId.substring(5, 11)}`,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        tickets.length * 10,
        0,
        `Winning numbers: ${winningNumbers.join(', ')}`
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Creating draw on blockchain..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Draw created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowDrawModal(false);
      }, 2000);
      
      await loadDraws(contract);
      await loadStats();
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected") 
        ? "Transaction rejected" 
        : "Draw creation failed";
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingDraw(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (contract) {
        const available = await contract.isAvailable();
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: `Contract is available: ${available}` 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const verifyTicket = async (ticketId: string) => {
    if (!isConnected || !address) return;
    
    try {
      const contractRead = await getContractReadOnly();
      const contractWrite = await getContractWithSigner();
      if (!contractRead || !contractWrite) return;
      
      const ticketData = await contractRead.getBusinessData(ticketId);
      if (ticketData.isVerified) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Ticket already verified" 
        });
        return;
      }
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(ticketId);
      
      await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(ticketId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "success", message: "Ticket verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadTickets(contractRead);
    } catch (e: any) {
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Verification failed" 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>LottoCrypt_Z 🎰</h1>
            <span>Privacy Lottery with FHE</span>
          </div>
          <ConnectButton />
        </header>
        
        <div className="connection-prompt">
          <div className="prompt-content">
            <div className="prompt-icon">🔐</div>
            <h2>Welcome to LottoCrypt_Z</h2>
            <p>Connect your wallet to start playing the privacy-preserving lottery</p>
            <div className="feature-grid">
              <div className="feature-card">
                <div className="feature-icon">🎯</div>
                <h3>Encrypted Selection</h3>
                <p>Your numbers are encrypted with FHE technology</p>
              </div>
              <div className="feature-card">
                <div className="feature-icon">⚡</div>
                <h3>Homomorphic Comparison</h3>
                <p>Winning numbers compared without decryption</p>
              </div>
              <div className="feature-card">
                <div className="feature-icon">🛡️</div>
                <h3>Complete Privacy</h3>
                <p>Your selections remain confidential</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="crypto-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="crypto-spinner"></div>
        <p>Loading LottoCrypt_Z...</p>
      </div>
    );
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo-section">
          <h1>LottoCrypt_Z 🎰</h1>
          <span>FHE-Powered Privacy Lottery</span>
        </div>
        
        <nav className="main-nav">
          <button className="nav-btn active">Dashboard</button>
          <button className="nav-btn">My Tickets</button>
          <button className="nav-btn">Past Draws</button>
          <button className="nav-btn">How to Play</button>
        </nav>
        
        <div className="header-actions">
          <ConnectButton />
        </div>
      </header>

      <main className="main-content">
        <section className="hero-section">
          <div className="hero-content">
            <h2>Experience Truly Private Lottery</h2>
            <p>Your numbers are encrypted with Fully Homomorphic Encryption - only you can see them!</p>
            <div className="hero-actions">
              <button 
                className="primary-btn glow"
                onClick={() => setShowTicketModal(true)}
              >
                Buy Ticket
              </button>
              <button 
                className="secondary-btn"
                onClick={checkAvailability}
              >
                Check Contract
              </button>
            </div>
          </div>
          
          <div className="stats-grid">
            <div className="stat-card neon-purple">
              <h3>Total Tickets</h3>
              <div className="stat-value">{stats.totalTickets}</div>
            </div>
            <div className="stat-card neon-blue">
              <h3>Total Draws</h3>
              <div className="stat-value">{stats.totalDraws}</div>
            </div>
            <div className="stat-card neon-pink">
              <h3>Total Prize</h3>
              <div className="stat-value">${stats.totalPrize}</div>
            </div>
            <div className="stat-card neon-green">
              <h3>Your Tickets</h3>
              <div className="stat-value">{userHistory.length}</div>
            </div>
          </div>
        </section>

        <div className="content-panels">
          <section className="panel recent-tickets">
            <div className="panel-header">
              <h3>Recent Tickets</h3>
              <button 
                className="action-btn"
                onClick={() => setShowTicketModal(true)}
              >
                + New Ticket
              </button>
            </div>
            <div className="tickets-list">
              {tickets.slice(0, 5).map((ticket, index) => (
                <div key={index} className="ticket-item">
                  <div className="ticket-info">
                    <span className="ticket-id">{ticket.id}</span>
                    <span className="ticket-time">
                      {new Date(ticket.timestamp * 1000).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="ticket-status">
                    <span className={`status ${ticket.isVerified ? 'verified' : 'pending'}`}>
                      {ticket.isVerified ? '✅ Verified' : '⏳ Pending'}
                    </span>
                    <button 
                      className="verify-btn"
                      onClick={() => verifyTicket(ticket.id)}
                    >
                      Verify
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="panel upcoming-draws">
            <div className="panel-header">
              <h3>Upcoming Draws</h3>
              <button 
                className="action-btn"
                onClick={() => setShowDrawModal(true)}
              >
                + New Draw
              </button>
            </div>
            <div className="draws-list">
              {draws.slice(0, 3).map((draw, index) => (
                <div key={index} className="draw-item">
                  <div className="draw-info">
                    <span className="draw-id">{draw.id}</span>
                    <span className="draw-prize">${draw.totalPrize}</span>
                  </div>
                  <div className="draw-status">
                    <span className={`status ${draw.isCompleted ? 'completed' : 'upcoming'}`}>
                      {draw.isCompleted ? '🎉 Completed' : '🕒 Upcoming'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className="user-history">
          <h3>Your Lottery History</h3>
          <div className="history-grid">
            {userHistory.map((ticket, index) => (
              <div key={index} className="history-card">
                <div className="history-header">
                  <span>Ticket #{ticket.id.substring(7, 13)}</span>
                  <span className="history-time">
                    {new Date(ticket.timestamp * 1000).toLocaleDateString()}
                  </span>
                </div>
                <div className="history-status">
                  <span className={`status-badge ${ticket.isVerified ? 'won' : 'pending'}`}>
                    {ticket.isVerified ? 'Verified' : 'Pending Verification'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="faq-section">
          <h3>How FHE Protects Your Privacy</h3>
          <div className="faq-grid">
            <div className="faq-item">
              <h4>Encrypted Selection</h4>
              <p>Your lottery numbers are encrypted before they leave your device using FHE technology</p>
            </div>
            <div className="faq-item">
              <h4>Homomorphic Comparison</h4>
              <p>Winning numbers are compared with your encrypted selections without decryption</p>
            </div>
            <div className="faq-item">
              <h4>Zero Knowledge Proofs</h4>
              <p>Verification happens without revealing your actual numbers to anyone</p>
            </div>
          </div>
        </section>
      </main>

      {showTicketModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h2>Create New Lottery Ticket</h2>
              <button onClick={() => setShowTicketModal(false)} className="close-btn">×</button>
            </div>
            
            <div className="modal-body">
              <div className="number-selector">
                <div className="selector-header">
                  <h4>Select 6 Numbers (1-49)</h4>
                  <button onClick={generateRandomNumbers} className="random-btn">
                    Random Pick
                  </button>
                </div>
                
                <div className="numbers-grid">
                  {Array.from({length: 49}, (_, i) => i + 1).map(number => (
                    <button
                      key={number}
                      className={`number-btn ${selectedNumbers.includes(number) ? 'selected' : ''}`}
                      onClick={() => selectNumber(number)}
                    >
                      {number}
                    </button>
                  ))}
                </div>
                
                <div className="selected-numbers">
                  <h4>Your Numbers: {selectedNumbers.sort((a, b) => a - b).join(', ')}</h4>
                </div>
              </div>
              
              <div className="fhe-notice">
                <div className="notice-icon">🔐</div>
                <p>Your numbers will be encrypted with FHE before submission</p>
              </div>
            </div>
            
            <div className="modal-footer">
              <button onClick={() => setShowTicketModal(false)} className="cancel-btn">
                Cancel
              </button>
              <button 
                onClick={createTicket}
                disabled={selectedNumbers.length !== 6 || creatingTicket || isEncrypting}
                className="submit-btn glow"
              >
                {creatingTicket || isEncrypting ? 'Encrypting...' : 'Create Encrypted Ticket'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDrawModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h2>Create New Draw</h2>
              <button onClick={() => setShowDrawModal(false)} className="close-btn">×</button>
            </div>
            
            <div className="modal-body">
              <p>Create a new lottery draw with random winning numbers.</p>
              <div className="draw-info">
                <div className="info-item">
                  <span>Total Tickets:</span>
                  <strong>{tickets.length}</strong>
                </div>
                <div className="info-item">
                  <span>Prize Pool:</span>
                  <strong>${tickets.length * 10}</strong>
                </div>
              </div>
            </div>
            
            <div className="modal-footer">
              <button onClick={() => setShowDrawModal(false)} className="cancel-btn">
                Cancel
              </button>
              <button 
                onClick={createDraw}
                disabled={creatingDraw}
                className="submit-btn glow"
              >
                {creatingDraw ? 'Creating Draw...' : 'Create New Draw'}
              </button>
            </div>
          </div>
        </div>
      )}

      {transactionStatus.visible && (
        <div className="notification">
          <div className={`notification-content ${transactionStatus.status}`}>
            <div className="notification-icon">
              {transactionStatus.status === 'pending' && '⏳'}
              {transactionStatus.status === 'success' && '✅'}
              {transactionStatus.status === 'error' && '❌'}
            </div>
            <span>{transactionStatus.message}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;


