// SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";


contract DutchMarket {

    using SafeMath for uint256;

    struct Account {
        uint256 ethBalance;
        mapping(address => uint256) tokenBalances;
    }

    mapping(address => Account) public accounts;
    
    struct SellOffer {
        address seller;
        address token;
        uint256 amount;
        uint256 price;
        bool active;
    }
    
    uint256 public nextOfferId = 1;
    mapping(uint256 => SellOffer) public sellOffers;

    // Add events
    event DepositEth(address indexed user, uint256 amount);
    event DepositToken(address indexed user, address token, uint256 amount);
    event WithdrawEth(address indexed user, uint256 amount);
    event WithdrawToken(address indexed user, address token, uint256 amount);
    event CreateSellOffer(address indexed user, address token, uint256 amount, uint256 price, uint256 offerId);
    event ReduceSellOfferPrice(address indexed user, uint256 offerId, uint256 newPrice);
    event WithdrawSellOffer(address indexed user, uint256 offerId);

    // Account Management
    function depositEth() public payable {
        require(msg.value > 0, "Deposit amount must be greater than 0");
        accounts[msg.sender].ethBalance += msg.value;
        emit DepositEth(msg.sender, msg.value);
    }

    function depositToken(address token, uint256 amount) public {
        require(amount > 0, "Deposit amount must be greater than 0");
        IERC20(token).transferFrom(msg.sender, address(this), amount);
        accounts[msg.sender].tokenBalances[token] += amount;
    }
    
    function withdrawEth(uint256 amount) public {
        require(accounts[msg.sender].ethBalance >= amount, "Insufficient balance");
        accounts[msg.sender].ethBalance -= amount;
        payable(msg.sender).transfer(amount);
    }

    function withdrawToken(address token, uint256 amount) public {
        require(accounts[msg.sender].tokenBalances[token] >= amount, "Insufficient balance");
        accounts[msg.sender].tokenBalances[token] -= amount;
        IERC20(token).transfer(msg.sender, amount);
    }

    function getEthBalance(address user) public view returns (uint256) {
        return accounts[user].ethBalance;
    }

    function getTokenBalance(address user, address token) public view returns (uint256) {
        return accounts[user].tokenBalances[token];
    }


    // Seller Functions
    function createSellOffer(address token, uint256 amount, uint256 price) public {
        require(accounts[msg.sender].tokenBalances[token] >= amount, "Insufficient balance");
        accounts[msg.sender].tokenBalances[token] -= amount;

        sellOffers[nextOfferId] = SellOffer({
            seller: msg.sender,
            token: token,
            amount: amount,
            price: price,
            active: true
        });
        nextOfferId++;
        emit CreateSellOffer(msg.sender, token, amount, price, nextOfferId - 1);
    }

    
    function reduceSellOfferPrice(uint256 offerId, uint256 newPrice) public {
        SellOffer storage offer = sellOffers[offerId];
        require(offer.seller == msg.sender, "Only the seller can reduce the price");
        require(offer.active, "Offer is not active");
        require(newPrice < offer.price, "New price must be lower than the current price");
        
        offer.price = newPrice;
        emit ReduceSellOfferPrice(msg.sender, offerId, newPrice);

    }
    
    function withdrawSellOffer(uint256 offerId) public {
        SellOffer storage offer = sellOffers[offerId];
        require(offer.seller == msg.sender, "Only the seller can withdraw the offer");
        require(offer.active, "Offer is not active");
        
        offer.active = false;
        accounts[msg.sender].tokenBalances[offer.token] += offer.amount;
        emit WithdrawSellOffer(msg.sender, offerId);

    }

    // ERC20 -- part 2


    struct BlindedBid {
        address bidder;
        bytes32 bidHash;
        bool opened;
    }

    uint256 public nextBlindedBidId = 1;
    mapping(uint256 => BlindedBid) public blindedBids;

    event BlindedBidSubmitted(uint256 blindedBidId, address indexed bidder, bytes32 bidHash);

    function submitBlindedBid(bytes32 bidHash, address bidder) public {

        uint256 blindedBidId = nextBlindedBidId;
        blindedBids[blindedBidId] = BlindedBid({bidder: bidder, bidHash: bidHash, opened: false});

        emit BlindedBidSubmitted(blindedBidId, bidder, bidHash);

        nextBlindedBidId++;
    }


    function matchBid(uint256 sellOfferId, uint256 amount, uint256 price) internal {
        SellOffer storage offer = sellOffers[sellOfferId];

        require(offer.active, "Sell offer is not active");
        require(price >= offer.price, "Bid price is lower than the sell offer price");

        uint256 matchedAmount = (amount <= offer.amount) ? amount : offer.amount;
        uint256 totalPrice = matchedAmount.mul(price);

        require(accounts[msg.sender].ethBalance >= totalPrice, "Insufficient ETH balance");

        // Update the balances
        accounts[offer.seller].tokenBalances[offer.token] = accounts[offer.seller].tokenBalances[offer.token].sub(matchedAmount);
        accounts[msg.sender].tokenBalances[offer.token] = accounts[msg.sender].tokenBalances[offer.token].add(matchedAmount);
        accounts[msg.sender].ethBalance = accounts[msg.sender].ethBalance.sub(totalPrice); // Decrease buyer's ETH balance
        accounts[offer.seller].ethBalance = accounts[offer.seller].ethBalance.add(totalPrice);

        // Update the sell offer
        if (offer.amount == matchedAmount) {
            offer.active = false;
        } else {
            offer.amount = offer.amount.sub(matchedAmount);
        }
    }



    function openBlindedBid(uint256 blindedBidId, uint256 sellOfferId, uint256 amount, uint256 price, string memory salt) public {
    BlindedBid storage bid = blindedBids[blindedBidId];
    require(!bid.opened, "Bid is already opened");

    // Verify the bid hash
    bytes32 expectedHash = keccak256(abi.encodePacked(msg.sender, amount, price, salt));
    require(bid.bidHash == expectedHash, "Invalid bid parameters");

    matchBid(sellOfferId, amount, price);

    bid.opened = true;
}



}
