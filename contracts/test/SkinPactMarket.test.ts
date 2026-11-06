import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { keccak256, parseEther, toUtf8Bytes } from "ethers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { SkinPactMarket } from "../typechain-types";

const PRICE = parseEther("0.01");
const BOND = parseEther("0.001");
const MAX_PRICE = parseEther("0.1");
const MIN_BOND = parseEther("0.001");
const OFFER_WINDOW = 600;
const CHALLENGE_WINDOW = 300;
const DELIVERY_WINDOW = 3_600;
const ITEM_HASH = keccak256(toUtf8Bytes("item-1"));
const ITEM_HASH_2 = keccak256(toUtf8Bytes("item-2"));
const OFFER_HASH = keccak256(toUtf8Bytes("offer-1"));
const OFFER_HASH_2 = keccak256(toUtf8Bytes("offer-2"));
const EVIDENCE_HASH = keccak256(toUtf8Bytes("evidence-1"));

describe("SkinPactMarket (S1 + S2-mini)", () => {
  let market: SkinPactMarket;
  let seller: HardhatEthersSigner;
  let buyer: HardhatEthersSigner;
  let other: HardhatEthersSigner;
  let arbiter: HardhatEthersSigner;

  beforeEach(async () => {
    [seller, buyer, other, arbiter] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("SkinPactMarket");
    market = (await Factory.deploy(
      MAX_PRICE,
      MIN_BOND,
      OFFER_WINDOW,
      CHALLENGE_WINDOW,
      DELIVERY_WINDOW,
      arbiter.address,
    )) as unknown as SkinPactMarket;
    await market.waitForDeployment();
  });

  async function create(hash = ITEM_HASH, price = PRICE, value = BOND) {
    await market.connect(seller).createListing(hash, price, { value });
    return (await market.nextListingId()) - 1n;
  }

  async function createAndBuy(hash = ITEM_HASH) {
    const id = await create(hash);
    await market.connect(buyer).buy(id, { value: PRICE });
    return id;
  }

  async function createBuyMark(hash = ITEM_HASH, offerHash = OFFER_HASH) {
    const id = await createAndBuy(hash);
    await market.connect(seller).markOfferSent(id, offerHash);
    return id;
  }

  describe("constructor", () => {
    it("exposes the delivery window and immutable arbiter", async () => {
      expect(await market.deliveryWindow()).to.equal(BigInt(DELIVERY_WINDOW));
      expect(await market.arbiter()).to.equal(arbiter.address);
    });

    it("rejects a zero delivery window or arbiter", async () => {
      const Factory = await ethers.getContractFactory("SkinPactMarket");
      await expect(
        Factory.deploy(
          MAX_PRICE,
          MIN_BOND,
          OFFER_WINDOW,
          CHALLENGE_WINDOW,
          0,
          arbiter.address,
        ),
      ).to.be.revertedWithCustomError(market, "InvalidConfig");
      await expect(
        Factory.deploy(
          MAX_PRICE,
          MIN_BOND,
          OFFER_WINDOW,
          CHALLENGE_WINDOW,
          DELIVERY_WINDOW,
          ethers.ZeroAddress,
        ),
      ).to.be.revertedWithCustomError(market, "InvalidConfig");
    });
  });

  describe("createListing", () => {
    it("locks the bond and computes the quoted bond", async () => {
      expect(await market.quoteBond(PRICE)).to.equal(BOND);
      expect(await market.quoteBond(1n)).to.equal(MIN_BOND);
      await create();

      expect(await ethers.provider.getBalance(await market.getAddress())).to.equal(BOND);
      expect(await market.activeItemHash(ITEM_HASH)).to.equal(1n);

      const listing = await market.getListing(1);
      expect(listing.seller).to.equal(seller.address);
      expect(listing.buyer).to.equal(ethers.ZeroAddress);
      expect(listing.price).to.equal(PRICE);
      expect(listing.bond).to.equal(BOND);
      expect(listing.itemHash).to.equal(ITEM_HASH);
      expect(listing.status).to.equal(1n); // Active
      expect(listing.offerDeadline).to.equal(0n);
    });

    it("rejects invalid price, item hash and bond", async () => {
      await expect(
        market.connect(seller).createListing(ITEM_HASH, 0, { value: BOND }),
      ).to.be.revertedWithCustomError(market, "InvalidPrice");
      await expect(
        market.connect(seller).createListing(ITEM_HASH, MAX_PRICE + 1n, { value: BOND }),
      ).to.be.revertedWithCustomError(market, "InvalidPrice");
      await expect(
        market.connect(seller).createListing(ethers.ZeroHash, PRICE, { value: BOND }),
      ).to.be.revertedWithCustomError(market, "InvalidItemHash");
      await expect(
        market.connect(seller).createListing(ITEM_HASH, PRICE, { value: BOND - 1n }),
      ).to.be.revertedWithCustomError(market, "IncorrectBond");
    });

    it("rejects a duplicate active item hash", async () => {
      await create();
      await expect(
        market.connect(seller).createListing(ITEM_HASH, PRICE, { value: BOND }),
      ).to.be.revertedWithCustomError(market, "ItemAlreadyListed");
    });

    it("allows relisting after a refund frees the item hash", async () => {
      const id = await createAndBuy();
      await time.increase(OFFER_WINDOW + 1);
      await market.connect(other).expireOrder(id);
      expect(await market.activeItemHash(ITEM_HASH)).to.equal(0n);
      await market.connect(seller).createListing(ITEM_HASH, PRICE, { value: BOND });
    });
  });

  describe("buy", () => {
    it("requires exact price and records the buyer/deadline", async () => {
      const id = await create();
      await expect(
        market.connect(buyer).buy(id, { value: PRICE - 1n }),
      ).to.be.revertedWithCustomError(market, "IncorrectPrice");
      await expect(
        market.connect(buyer).buy(id, { value: PRICE + 1n }),
      ).to.be.revertedWithCustomError(market, "IncorrectPrice");
      await expect(
        market.connect(seller).buy(id, { value: PRICE }),
      ).to.be.revertedWithCustomError(market, "SelfBuy");

      await market.connect(buyer).buy(id, { value: PRICE });
      const listing = await market.getListing(id);
      expect(listing.buyer).to.equal(buyer.address);
      expect(listing.status).to.equal(2n); // Funded
      expect(listing.offerDeadline).to.be.greaterThan(0n);
      expect(await ethers.provider.getBalance(await market.getAddress())).to.equal(
        PRICE + BOND,
      );
    });

    it("cannot buy twice or buy a non-active listing", async () => {
      const id = await createAndBuy();
      await expect(
        market.connect(other).buy(id, { value: PRICE }),
      ).to.be.revertedWithCustomError(market, "NotActive");
      await expect(
        market.connect(other).buy(999n, { value: PRICE }),
      ).to.be.revertedWithCustomError(market, "UnknownListing");
    });

    it("rejects unknown listing ids", async () => {
      await expect(
        market.connect(buyer).buy(1n, { value: PRICE }),
      ).to.be.revertedWithCustomError(market, "UnknownListing");
    });
  });

  describe("markOfferSent", () => {
    it("does not release escrow and records the declaration", async () => {
      const id = await createAndBuy();
      expect(await market.withdrawable(seller.address)).to.equal(0n);
      const before = await ethers.provider.getBalance(await market.getAddress());

      await market.connect(seller).markOfferSent(id, OFFER_HASH);

      expect(await market.withdrawable(seller.address)).to.equal(0n);
      expect(await ethers.provider.getBalance(await market.getAddress())).to.equal(before);
      const listing = await market.getListing(id);
      expect(listing.status).to.equal(3n); // OfferSent
      expect(listing.offerIdHash).to.equal(OFFER_HASH);
      expect(listing.deliveryDeadline).to.be.greaterThan(0n);
      expect(await market.usedOfferIdHash(OFFER_HASH)).to.equal(true);
    });

    it("enforces seller, state, hash and deadline", async () => {
      const id = await createAndBuy();
      await expect(
        market.connect(other).markOfferSent(id, OFFER_HASH),
      ).to.be.revertedWithCustomError(market, "NotSeller");
      await expect(
        market.connect(seller).markOfferSent(id, ethers.ZeroHash),
      ).to.be.revertedWithCustomError(market, "InvalidOfferHash");

      await market.connect(seller).createListing(ITEM_HASH_2, PRICE, { value: BOND });
      await expect(
        market.connect(seller).markOfferSent(2n, OFFER_HASH),
      ).to.be.revertedWithCustomError(market, "NotFunded");

      await time.increase(OFFER_WINDOW);
      await expect(
        market.connect(seller).markOfferSent(id, OFFER_HASH),
      ).to.be.revertedWithCustomError(market, "OfferDeadlinePassed");
    });

    it("blocks reusing an offer hash across listings", async () => {
      const first = await createBuyMark(ITEM_HASH, OFFER_HASH);
      const second = await createAndBuy(ITEM_HASH_2);
      await expect(
        market.connect(seller).markOfferSent(second, OFFER_HASH),
      ).to.be.revertedWithCustomError(market, "OfferHashAlreadyUsed");
      expect((await market.getListing(first)).status).to.equal(3n);
    });
  });

  describe("confirmReceipt", () => {
    it("pays price + bond on the buyer fast path and supports Funded without mark", async () => {
      const id = await createAndBuy();
      await market.connect(buyer).confirmReceipt(id);

      expect(await market.withdrawable(seller.address)).to.equal(PRICE + BOND);
      expect((await market.getListing(id)).status).to.equal(5n); // Completed
      expect(await market.activeItemHash(ITEM_HASH)).to.equal(0n);

      await market.connect(seller).withdraw();
      expect(await ethers.provider.getBalance(await market.getAddress())).to.equal(0n);
    });

    it("enforces buyer, valid state and no double settlement", async () => {
      const id = await createAndBuy();
      await expect(
        market.connect(seller).confirmReceipt(id),
      ).to.be.revertedWithCustomError(market, "NotBuyer");
      await market.connect(buyer).confirmReceipt(id);
      await expect(
        market.connect(buyer).confirmReceipt(id),
      ).to.be.revertedWithCustomError(market, "InvalidStatus");
    });

    it("also works from OfferSent and ClaimPending", async () => {
      const offerSent = await createBuyMark();
      await market.connect(buyer).confirmReceipt(offerSent);
      expect((await market.getListing(offerSent)).status).to.equal(5n);

      const claimPending = await createBuyMark(ITEM_HASH_2, OFFER_HASH_2);
      await market.connect(seller).claimAccepted(claimPending, EVIDENCE_HASH);
      await market.connect(buyer).confirmReceipt(claimPending);
      expect((await market.getListing(claimPending)).status).to.equal(5n);
    });

    it("cannot confirm while a dispute is open", async () => {
      const id = await createBuyMark();
      await market.connect(buyer).openDispute(id, EVIDENCE_HASH);
      await expect(
        market.connect(buyer).confirmReceipt(id),
      ).to.be.revertedWithCustomError(market, "InvalidStatus");
    });
  });

  describe("claimAccepted / finalizeClaim", () => {
    it("records evidence, starts a challenge and finalizes only after it", async () => {
      const id = await createBuyMark();
      await expect(
        market.connect(buyer).claimAccepted(id, EVIDENCE_HASH),
      ).to.be.revertedWithCustomError(market, "NotSeller");
      await expect(
        market.connect(seller).claimAccepted(id, ethers.ZeroHash),
      ).to.be.revertedWithCustomError(market, "InvalidEvidenceHash");

      await market.connect(seller).claimAccepted(id, EVIDENCE_HASH);
      const pending = await market.getListing(id);
      expect(pending.status).to.equal(4n); // ClaimPending
      expect(pending.evidenceHash).to.equal(EVIDENCE_HASH);
      expect(await market.withdrawable(seller.address)).to.equal(0n);

      await expect(
        market.connect(other).finalizeClaim(id),
      ).to.be.revertedWithCustomError(market, "ChallengeNotExpired");

      await time.increase(CHALLENGE_WINDOW);
      await market.connect(other).finalizeClaim(id);
      expect((await market.getListing(id)).status).to.equal(5n);
      expect(await market.withdrawable(seller.address)).to.equal(PRICE + BOND);
    });

    it("requires OfferSent and cannot claim twice", async () => {
      const id = await createAndBuy();
      await expect(
        market.connect(seller).claimAccepted(id, EVIDENCE_HASH),
      ).to.be.revertedWithCustomError(market, "NotOfferSent");
      await market.connect(seller).markOfferSent(id, OFFER_HASH);
      await market.connect(seller).claimAccepted(id, EVIDENCE_HASH);
      await expect(
        market.connect(seller).claimAccepted(id, EVIDENCE_HASH),
      ).to.be.revertedWithCustomError(market, "NotOfferSent");
    });

    it("rejects finalize before ClaimPending and after settlement", async () => {
      const id = await createBuyMark();
      await expect(
        market.connect(other).finalizeClaim(id),
      ).to.be.revertedWithCustomError(market, "NotClaimPending");
      await market.connect(seller).claimAccepted(id, EVIDENCE_HASH);
      await time.increase(CHALLENGE_WINDOW);
      await market.connect(other).finalizeClaim(id);
      await expect(
        market.connect(other).finalizeClaim(id),
      ).to.be.revertedWithCustomError(market, "NotClaimPending");
    });
  });

  describe("expireOrder", () => {
    it("refunds buyer price and seller bond after the offer deadline", async () => {
      const id = await createAndBuy();
      await expect(
        market.connect(other).expireOrder(id),
      ).to.be.revertedWithCustomError(market, "OfferDeadlineNotReached");

      await time.increase(OFFER_WINDOW);
      await market.connect(other).expireOrder(id);
      expect((await market.getListing(id)).status).to.equal(6n); // Refunded
      expect(await market.withdrawable(buyer.address)).to.equal(PRICE);
      expect(await market.withdrawable(seller.address)).to.equal(BOND);
      expect(await market.activeItemHash(ITEM_HASH)).to.equal(0n);
      expect(await ethers.provider.getBalance(await market.getAddress())).to.equal(
        PRICE + BOND,
      );

      await market.connect(buyer).withdraw();
      await market.connect(seller).withdraw();
      expect(await ethers.provider.getBalance(await market.getAddress())).to.equal(0n);

      await expect(
        market.connect(other).expireOrder(id),
      ).to.be.revertedWithCustomError(market, "NotFunded");
    });

    it("cannot expire once an offer has been marked", async () => {
      const id = await createBuyMark();
      await time.increase(OFFER_WINDOW + 1);
      await expect(
        market.connect(other).expireOrder(id),
      ).to.be.revertedWithCustomError(market, "NotFunded");
    });
  });

  describe("cancelListing", () => {
    it("refunds the bond, frees the item hash and allows relisting", async () => {
      const id = await create();
      await expect(
        market.connect(buyer).cancelListing(id),
      ).to.be.revertedWithCustomError(market, "NotSeller");

      await market.connect(seller).cancelListing(id);
      const listing = await market.getListing(id);
      expect(listing.status).to.equal(8n); // Cancelled
      expect(await market.withdrawable(seller.address)).to.equal(BOND);
      expect(await market.activeItemHash(ITEM_HASH)).to.equal(0n);
      expect(await ethers.provider.getBalance(await market.getAddress())).to.equal(BOND);

      await market.connect(seller).withdraw();
      expect(await ethers.provider.getBalance(await market.getAddress())).to.equal(0n);

      await market.connect(seller).createListing(ITEM_HASH, PRICE, { value: BOND });
      await expect(
        market.connect(seller).cancelListing(id),
      ).to.be.revertedWithCustomError(market, "NotActive");
    });

    it("cannot cancel a funded listing", async () => {
      const id = await createAndBuy();
      await expect(
        market.connect(seller).cancelListing(id),
      ).to.be.revertedWithCustomError(market, "NotActive");
    });
  });

  describe("openDispute", () => {
    it("lets buyer or seller dispute from OfferSent before the delivery deadline", async () => {
      const id = await createBuyMark();
      const listing = await market.getListing(id);
      expect(listing.deliveryDeadline).to.be.greaterThan(0n);

      await expect(
        market.connect(other).openDispute(id, EVIDENCE_HASH),
      ).to.be.revertedWithCustomError(market, "DisputeNotAllowed");

      await market.connect(buyer).openDispute(id, EVIDENCE_HASH);
      const disputed = await market.getListing(id);
      expect(disputed.status).to.equal(7n); // Disputed
      expect(disputed.disputeHash).to.equal(EVIDENCE_HASH);
      expect(disputed.disputer).to.equal(buyer.address);
      expect(await market.withdrawable(seller.address)).to.equal(0n);
    });

    it("allows anyone to escalate after the delivery deadline", async () => {
      const id = await createBuyMark();
      await time.increase(DELIVERY_WINDOW + 1);
      await market.connect(other).openDispute(id, EVIDENCE_HASH);
      const listing = await market.getListing(id);
      expect(listing.status).to.equal(7n);
      expect(listing.disputer).to.equal(other.address);
    });

    it("rejects zero hashes, wrong states and double disputes", async () => {
      const id = await createAndBuy();
      await expect(
        market.connect(buyer).openDispute(id, EVIDENCE_HASH),
      ).to.be.revertedWithCustomError(market, "InvalidStatus");

      await market.connect(seller).markOfferSent(id, OFFER_HASH);
      await expect(
        market.connect(buyer).openDispute(id, ethers.ZeroHash),
      ).to.be.revertedWithCustomError(market, "InvalidDisputeHash");

      await market.connect(buyer).openDispute(id, EVIDENCE_HASH);
      await expect(
        market.connect(seller).openDispute(id, EVIDENCE_HASH),
      ).to.be.revertedWithCustomError(market, "InvalidStatus");
    });

    it("lets only the buyer dispute from ClaimPending before the challenge deadline", async () => {
      const id = await createBuyMark();
      await market.connect(seller).claimAccepted(id, EVIDENCE_HASH);

      await expect(
        market.connect(seller).openDispute(id, EVIDENCE_HASH),
      ).to.be.revertedWithCustomError(market, "NotBuyer");
      await expect(
        market.connect(other).openDispute(id, EVIDENCE_HASH),
      ).to.be.revertedWithCustomError(market, "NotBuyer");

      await market.connect(buyer).openDispute(id, EVIDENCE_HASH);
      expect((await market.getListing(id)).status).to.equal(7n);
    });

    it("rejects a ClaimPending dispute after the challenge deadline", async () => {
      const id = await createBuyMark();
      await market.connect(seller).claimAccepted(id, EVIDENCE_HASH);
      await time.increase(CHALLENGE_WINDOW);
      await expect(
        market.connect(buyer).openDispute(id, EVIDENCE_HASH),
      ).to.be.revertedWithCustomError(market, "DisputeDeadlinePassed");
    });
  });

  describe("resolveDispute", () => {
    async function disputed() {
      const id = await createBuyMark();
      await market.connect(buyer).openDispute(id, EVIDENCE_HASH);
      return id;
    }

    it("only the arbiter can resolve, only in Disputed, without contradictory flags", async () => {
      const id = await createBuyMark();
      await expect(
        market.connect(arbiter).resolveDispute(id, true, false),
      ).to.be.revertedWithCustomError(market, "NotDisputed");

      await market.connect(buyer).openDispute(id, EVIDENCE_HASH);
      await expect(
        market.connect(other).resolveDispute(id, true, false),
      ).to.be.revertedWithCustomError(market, "NotArbiter");
      await expect(
        market.connect(arbiter).resolveDispute(id, true, true),
      ).to.be.revertedWithCustomError(market, "InvalidResolution");
    });

    it("pays price + bond to the seller when the seller wins", async () => {
      const id = await disputed();
      await market.connect(arbiter).resolveDispute(id, true, false);

      expect((await market.getListing(id)).status).to.equal(5n); // Completed
      expect(await market.withdrawable(seller.address)).to.equal(PRICE + BOND);
      expect(await market.withdrawable(buyer.address)).to.equal(0n);
      expect(await market.activeItemHash(ITEM_HASH)).to.equal(0n);
      expect(await ethers.provider.getBalance(await market.getAddress())).to.equal(
        PRICE + BOND,
      );

      await expect(
        market.connect(arbiter).resolveDispute(id, true, false),
      ).to.be.revertedWithCustomError(market, "NotDisputed");
    });

    it("refunds the buyer and returns the bond when the buyer wins without slashing", async () => {
      const id = await disputed();
      await market.connect(arbiter).resolveDispute(id, false, false);

      expect((await market.getListing(id)).status).to.equal(6n); // Refunded
      expect(await market.withdrawable(buyer.address)).to.equal(PRICE);
      expect(await market.withdrawable(seller.address)).to.equal(BOND);
      expect(await market.activeItemHash(ITEM_HASH)).to.equal(0n);
    });

    it("awards the seller bond to the buyer when slashing", async () => {
      const id = await disputed();
      await market.connect(arbiter).resolveDispute(id, false, true);

      expect((await market.getListing(id)).status).to.equal(6n);
      expect(await market.withdrawable(buyer.address)).to.equal(PRICE + BOND);
      expect(await market.withdrawable(seller.address)).to.equal(0n);
    });

    it("cannot finalize a claim after the buyer disputes it", async () => {
      const id = await createBuyMark();
      await market.connect(seller).claimAccepted(id, EVIDENCE_HASH);
      await market.connect(buyer).openDispute(id, EVIDENCE_HASH);
      await time.increase(CHALLENGE_WINDOW + 1);

      await expect(
        market.connect(other).finalizeClaim(id),
      ).to.be.revertedWithCustomError(market, "NotClaimPending");
    });
  });

  describe("accounting invariants", () => {
    async function escrowByStatus(): Promise<bigint> {
      let escrow = 0n;
      const next = await market.nextListingId();
      for (let id = 1n; id < next; id += 1n) {
        const listing = await market.getListing(id);
        if (listing.status === 1n) escrow += listing.bond; // Active
        if ([2n, 3n, 4n, 7n].includes(listing.status)) escrow += listing.price + listing.bond;
      }
      return escrow;
    }

    async function totalWithdrawable(): Promise<bigint> {
      let total = 0n;
      for (const signer of [seller, buyer, other]) {
        total += await market.withdrawable(signer.address);
      }
      return total;
    }

    async function expectInvariant(label: string): Promise<void> {
      const escrow = await escrowByStatus();
      const withdrawable = await totalWithdrawable();
      expect(
        await ethers.provider.getBalance(await market.getAddress()),
        `${label}: contract balance must equal escrow + withdrawable`,
      ).to.equal(escrow + withdrawable);
    }

    it("keeps balance = live escrow + pull-payment credits across mixed states", async () => {
      const hash = (n: number) => keccak256(toUtf8Bytes(`invariant-item-${n}`));
      const offerHash = (n: number) => keccak256(toUtf8Bytes(`invariant-offer-${n}`));

      // Completed + withdrawable credit.
      const completed = await create(hash(1));
      await market.connect(buyer).buy(completed, { value: PRICE });
      await market.connect(buyer).confirmReceipt(completed);

      // Funded.
      const funded = await create(hash(2));
      await market.connect(buyer).buy(funded, { value: PRICE });

      // OfferSent.
      const offerSent = await create(hash(3));
      await market.connect(buyer).buy(offerSent, { value: PRICE });
      await market.connect(seller).markOfferSent(offerSent, offerHash(3));

      // ClaimPending.
      const claimPending = await create(hash(4));
      await market.connect(buyer).buy(claimPending, { value: PRICE });
      await market.connect(seller).markOfferSent(claimPending, offerHash(4));
      await market.connect(seller).claimAccepted(claimPending, EVIDENCE_HASH);

      // Still Active.
      await create(hash(5));

      // Refunded after no offer.
      const expired = await create(hash(6));
      await market.connect(buyer).buy(expired, { value: PRICE });
      await time.increase(OFFER_WINDOW + 1);
      await market.connect(other).expireOrder(expired);

      await expectInvariant("mixed states");
      expect(await market.withdrawable(seller.address)).to.equal(PRICE + BOND + BOND);
      expect(await market.withdrawable(buyer.address)).to.equal(PRICE);
      expect(await market.withdrawable(other.address)).to.equal(0n);

      await market.connect(seller).withdraw();
      await market.connect(buyer).withdraw();
      await expectInvariant("after withdrawals");

      // The Completed/Refunded orders cannot settle again.
      await expect(
        market.connect(buyer).confirmReceipt(completed),
      ).to.be.revertedWithCustomError(market, "InvalidStatus");
      await expect(
        market.connect(other).expireOrder(expired),
      ).to.be.revertedWithCustomError(market, "NotFunded");
      await expectInvariant("after rejected double settlement");
    });

    it("keeps balance = escrow + credits with Cancelled and Disputed states", async () => {
      const hash = (n: number) => keccak256(toUtf8Bytes(`invariant-s2-item-${n}`));
      const offerHash = (n: number) => keccak256(toUtf8Bytes(`invariant-s2-offer-${n}`));

      // Active -> Cancelled: only the bond remains as a seller credit.
      const cancelled = await create(hash(1));
      await market.connect(seller).cancelListing(cancelled);
      await expectInvariant("after cancel");

      // Disputed: price + bond stay in escrow until the arbiter decides.
      const disputed = await create(hash(2));
      await market.connect(buyer).buy(disputed, { value: PRICE });
      await market.connect(seller).markOfferSent(disputed, offerHash(2));
      await market.connect(buyer).openDispute(disputed, EVIDENCE_HASH);
      await expectInvariant("disputed");

      // Buyer wins with the bond slashed to the buyer.
      await market.connect(arbiter).resolveDispute(disputed, false, true);
      await expectInvariant("resolved with slash");
      expect(await market.withdrawable(seller.address)).to.equal(BOND);
      expect(await market.withdrawable(buyer.address)).to.equal(PRICE + BOND);

      await market.connect(seller).withdraw();
      await market.connect(buyer).withdraw();
      await expectInvariant("after S2 withdrawals");
    });
  });

  describe("withdraw", () => {
    it("rejects an empty balance and allows only the credited account", async () => {
      await expect(
        market.connect(other).withdraw(),
      ).to.be.revertedWithCustomError(market, "NothingToWithdraw");
      await createAndBuy();
      await market.connect(buyer).confirmReceipt(1n);
      await expect(
        market.connect(buyer).withdraw(),
      ).to.be.revertedWithCustomError(market, "NothingToWithdraw");
      await market.connect(seller).withdraw();
      await expect(
        market.connect(seller).withdraw(),
      ).to.be.revertedWithCustomError(market, "NothingToWithdraw");
    });
  });
});
