const DutchMarket = artifacts.require("DutchMarket");
const MyToken = artifacts.require("MyToken");

contract("DutchMarket", (accounts) => {

   let dutchMarket, myToken;
   let buyer, buyerAccount;
   const [owner, seller, alice, bob, carol] = accounts;

   beforeEach(async () => {
   dutchMarket = await DutchMarket.new();
   myToken = await MyToken.new("My Token", "MTKN", "1000000000000000000000000", { from: alice });

  // Distribute tokens to test accounts
   await myToken.transfer(bob, "100000000000000000000", { from: alice });
   await myToken.transfer(carol, "100000000000000000000", { from: alice });
   await myToken.transfer(seller, "200000000000000000000", { from: alice }); // Transfer 200 tokens to the seller

 // Transfer Ether to Alice, Bob, Carol, and Seller accounts
  const txParams = {
    gas: 3000000,
    gasPrice: web3.utils.toWei("20", "gwei")
  };

  await web3.eth.sendTransaction({ ...txParams, from: owner, to: alice, value: web3.utils.toWei("10", "ether") });
  await web3.eth.sendTransaction({ ...txParams, from: owner, to: bob, value: web3.utils.toWei("10", "ether") });
  await web3.eth.sendTransaction({ ...txParams, from: owner, to: carol, value: web3.utils.toWei("10", "ether") });
  await web3.eth.sendTransaction({ ...txParams, from: owner, to: seller, value: web3.utils.toWei("10", "ether") });
 
  // Create buyer account
   buyerAccount = web3.eth.accounts.create();
   buyer = buyerAccount.address;
   await web3.eth.personal.importRawKey(buyerAccount.privateKey, '');
   await web3.eth.personal.unlockAccount(buyer, '', 600);
   web3.eth.defaultAccount = buyer;

  // Transfer Ether to buyer account
  await web3.eth.sendTransaction({ ...txParams, from: alice, to: buyer, value: web3.utils.toWei("500", "ether") });
   });


  it("should create an account and deposit ETH and ERC20 tokens", async () => {
    await dutchMarket.depositEth({ from: alice, value: "1000000000000000000" });

    await dutchMarket.getEthBalance(alice);
    const aliceEthBalance = await dutchMarket.getEthBalance(alice);
    assert.equal(aliceEthBalance.toString(), "1000000000000000000", "Incorrect ETH balance");

    await myToken.approve(dutchMarket.address, "1000000000000000000", { from: bob });
    await dutchMarket.depositToken(myToken.address, "1000000000000000000", { from: bob });

    const bobTokenBalance = await dutchMarket.getTokenBalance(bob, myToken.address);

    assert.equal(bobTokenBalance.toString(), "1000000000000000000", "Incorrect token balance");
  });

  it("should allow sellers to create and modify offers", async () => {
    await myToken.approve(dutchMarket.address, "1000000000000000000", { from: alice });
    await dutchMarket.depositToken(myToken.address, "1000000000000000000", { from: alice });

    await dutchMarket.createSellOffer(myToken.address, "100000000000000000", "1000000000000000000", { from: alice });

    const sellOffer = await dutchMarket.sellOffers(1);
    assert.equal(sellOffer.seller, alice, "Incorrect seller");
    assert.equal(sellOffer.token, myToken.address, "Incorrect token");
    assert.equal(sellOffer.amount.toString(), "100000000000000000", "Incorrect amount");
    assert.equal(sellOffer.price.toString(), "1000000000000000000", "Incorrect price");
    assert.equal(sellOffer.active, true, "Incorrect status");

    await dutchMarket.reduceSellOfferPrice(1, "900000000000000000", { from: alice });
    const updatedSellOffer = await dutchMarket.sellOffers(1);
    assert.equal(updatedSellOffer.price.toString(), "900000000000000000", "Incorrect updated price");

    await dutchMarket.withdrawSellOffer(1, { from: alice });
    const withdrawnSellOffer = await dutchMarket.sellOffers(1);
    assert.equal(withdrawnSellOffer.active, false, "Incorrect status after withdrawal");
  });

  // test cases for blinded bids and matching

  it("should submit, open, and match a blinded bid", async () => {

    // Seller creates a sell offer
    await myToken.approve(dutchMarket.address, web3.utils.toWei("150", "ether"), { from: seller });
    await dutchMarket.depositToken(myToken.address, web3.utils.toWei("150", "ether"), { from: seller });
    await dutchMarket.createSellOffer(myToken.address, 100, 10, { from: seller });

    // Transfer more Ether to buyer account
    await web3.eth.sendTransaction({ from: alice, to: buyer, value: web3.utils.toWei("10", "ether") });

    // Buyer deposits enough Ether into the DutchMarket contract
    await dutchMarket.depositEth({ from: buyer, value: web3.utils.toWei("500", "ether") });

    // Buyer prepares a blinded bid
    const sellOfferId = 1;
    const amount = 50;
    const price = 10;
    const token = myToken.address;

    const message = web3.utils.soliditySha3(
      { t: "uint256", v: amount },
      { t: "uint256", v: price },
      { t: "address", v: token },
      { t: "uint256", v: sellOfferId }
    );

    const signatureData = await web3.eth.accounts.sign(message, buyerAccount.privateKey);
    const signature = signatureData.signature;

    const bidHash = web3.utils.soliditySha3(message, signature);

    // Buyer submits the blinded bid
    const submitTx = await dutchMarket.submitBlindedBid(bidHash, buyer, { from: buyer });

    // Get the BlindedBidSubmitted event from the transaction logs
    const submittedEvent = submitTx.logs.find(log => log.event === "BlindedBidSubmitted");

    // If submittedEvent is undefined, throw an error
    if (!submittedEvent) {
      throw new Error('BlindedBidSubmitted event not found');
    }

    // Retrieve blindedBidId from the event
    const blindedBidId = submittedEvent.args.blindedBidId;

    // Buyer opens the blinded bid
    await dutchMarket.openBlindedBid(blindedBidId, sellOfferId, amount, price, { from: buyer });

    // Verify the signature
    const recoveredAddress = await web3.eth.accounts.recover(message, signature);
    assert.equal(recoveredAddress, buyer, "Invalid signature");

    // Check if the bid was successfully matched and the balances were updated accordingly
    const sellerTokenBalance = await dutchMarket.getTokenBalance(seller, token);
    const buyerTokenBalance = await dutchMarket.getTokenBalance(buyer, token);
    const sellerEthBalance = await dutchMarket.getEthBalance(seller);
    const buyerEthBalance = await dutchMarket.getEthBalance(buyer);

    assert(sellerTokenBalance.eq(web3.utils.toBN(50)), "Seller's token balance should be reduced by the matched amount");
    assert(buyerTokenBalance.eq(web3.utils.toBN(50)), "Buyer's token balance should be increased by the matched amount");
    assert(sellerEthBalance.eq(web3.utils.toBN(price * amount)), "Seller's ETH balance should be increased by the total bid value");
    assert(buyerEthBalance.eq(web3.utils.toBN(web3.utils.toWei("500", "ether")).sub(web3.utils.toBN(price * amount))), "Buyer's ETH balance should be reduced by the total bid value");
  });

});