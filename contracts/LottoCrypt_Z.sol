pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract LottoCrypt_Z is ZamaEthereumConfig {
    struct Ticket {
        euint32 encryptedNumbers;
        address player;
        uint256 timestamp;
        uint32 decryptedNumbers;
        bool isVerified;
    }

    struct Lottery {
        string lotteryId;
        euint32 encryptedWinningNumbers;
        uint256 ticketPrice;
        uint256 prizePool;
        uint256 ticketCount;
        uint256 drawTimestamp;
        bool isDrawn;
    }

    mapping(string => Lottery) public lotteries;
    mapping(string => mapping(address => Ticket)) public tickets;
    mapping(string => address[]) public ticketHolders;

    event LotteryCreated(string indexed lotteryId, address creator);
    event TicketPurchased(string indexed lotteryId, address indexed player);
    event WinningNumbersDrawn(string indexed lotteryId, euint32 encryptedWinningNumbers);
    event TicketVerified(string indexed lotteryId, address indexed player, uint32 decryptedNumbers);
    event PrizeClaimed(string indexed lotteryId, address indexed winner, uint256 amount);

    modifier onlyLotteryOwner(string memory lotteryId) {
        require(msg.sender == lotteries[lotteryId].creator, "Not lottery owner");
        _;
    }

    constructor() ZamaEthereumConfig() {}

    function createLottery(
        string calldata lotteryId,
        externalEuint32 encryptedWinningNumbers,
        bytes calldata inputProof,
        uint256 ticketPrice
    ) external {
        require(bytes(lotteries[lotteryId].lotteryId).length == 0, "Lottery already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedWinningNumbers, inputProof)), "Invalid encrypted input");

        lotteries[lotteryId] = Lottery({
            lotteryId: lotteryId,
            encryptedWinningNumbers: FHE.fromExternal(encryptedWinningNumbers, inputProof),
            ticketPrice: ticketPrice,
            prizePool: 0,
            ticketCount: 0,
            drawTimestamp: 0,
            isDrawn: false
        });

        FHE.allowThis(lotteries[lotteryId].encryptedWinningNumbers);
        FHE.makePubliclyDecryptable(lotteries[lotteryId].encryptedWinningNumbers);

        emit LotteryCreated(lotteryId, msg.sender);
    }

    function buyTicket(
        string calldata lotteryId,
        externalEuint32 encryptedNumbers,
        bytes calldata inputProof
    ) external payable {
        require(bytes(lotteries[lotteryId].lotteryId).length > 0, "Lottery does not exist");
        require(msg.value == lotteries[lotteryId].ticketPrice, "Incorrect ticket price");
        require(!lotteries[lotteryId].isDrawn, "Lottery already drawn");
        require(FHE.isInitialized(FHE.fromExternal(encryptedNumbers, inputProof)), "Invalid encrypted input");

        lotteries[lotteryId].prizePool += msg.value;
        lotteries[lotteryId].ticketCount++;

        tickets[lotteryId][msg.sender] = Ticket({
            encryptedNumbers: FHE.fromExternal(encryptedNumbers, inputProof),
            player: msg.sender,
            timestamp: block.timestamp,
            decryptedNumbers: 0,
            isVerified: false
        });

        FHE.allowThis(tickets[lotteryId][msg.sender].encryptedNumbers);
        FHE.makePubliclyDecryptable(tickets[lotteryId][msg.sender].encryptedNumbers);

        ticketHolders[lotteryId].push(msg.sender);

        emit TicketPurchased(lotteryId, msg.sender);
    }

    function drawWinningNumbers(string calldata lotteryId) external onlyLotteryOwner(lotteryId) {
        require(!lotteries[lotteryId].isDrawn, "Numbers already drawn");
        lotteries[lotteryId].isDrawn = true;
        lotteries[lotteryId].drawTimestamp = block.timestamp;
        emit WinningNumbersDrawn(lotteryId, lotteries[lotteryId].encryptedWinningNumbers);
    }

    function verifyTicket(
        string calldata lotteryId,
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(bytes(lotteries[lotteryId].lotteryId).length > 0, "Lottery does not exist");
        require(tickets[lotteryId][msg.sender].player == msg.sender, "Not ticket owner");
        require(!tickets[lotteryId][msg.sender].isVerified, "Ticket already verified");
        require(lotteries[lotteryId].isDrawn, "Winning numbers not drawn");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(tickets[lotteryId][msg.sender].encryptedNumbers);

        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);

        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));

        tickets[lotteryId][msg.sender].decryptedNumbers = decodedValue;
        tickets[lotteryId][msg.sender].isVerified = true;

        emit TicketVerified(lotteryId, msg.sender, decodedValue);
    }

    function claimPrize(string calldata lotteryId) external {
        require(bytes(lotteries[lotteryId].lotteryId).length > 0, "Lottery does not exist");
        require(tickets[lotteryId][msg.sender].player == msg.sender, "Not ticket owner");
        require(tickets[lotteryId][msg.sender].isVerified, "Ticket not verified");
        require(lotteries[lotteryId].isDrawn, "Winning numbers not drawn");

        // Homomorphic comparison would happen off-chain
        // For demonstration, we assume the comparison result is provided
        bool isWinner = true; 

        if (isWinner) {
            uint256 prizeAmount = lotteries[lotteryId].prizePool / lotteries[lotteryId].ticketCount;
            payable(msg.sender).transfer(prizeAmount);
            emit PrizeClaimed(lotteryId, msg.sender, prizeAmount);
        }
    }

    function getTicket(string calldata lotteryId, address player) external view returns (
        euint32 encryptedNumbers,
        uint256 timestamp,
        uint32 decryptedNumbers,
        bool isVerified
    ) {
        require(bytes(lotteries[lotteryId].lotteryId).length > 0, "Lottery does not exist");
        require(tickets[lotteryId][player].player == player, "Ticket does not exist");

        Ticket storage ticket = tickets[lotteryId][player];
        return (
            ticket.encryptedNumbers,
            ticket.timestamp,
            ticket.decryptedNumbers,
            ticket.isVerified
        );
    }

    function getLotteryDetails(string calldata lotteryId) external view returns (
        euint32 encryptedWinningNumbers,
        uint256 ticketPrice,
        uint256 prizePool,
        uint256 ticketCount,
        uint256 drawTimestamp,
        bool isDrawn
    ) {
        require(bytes(lotteries[lotteryId].lotteryId).length > 0, "Lottery does not exist");

        Lottery storage lottery = lotteries[lotteryId];
        return (
            lottery.encryptedWinningNumbers,
            lottery.ticketPrice,
            lottery.prizePool,
            lottery.ticketCount,
            lottery.drawTimestamp,
            lottery.isDrawn
        );
    }

    function getTicketHolders(string calldata lotteryId) external view returns (address[] memory) {
        require(bytes(lotteries[lotteryId].lotteryId).length > 0, "Lottery does not exist");
        return ticketHolders[lotteryId];
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}


