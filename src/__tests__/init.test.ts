import { labelIsCIP68, validBech32Address, validAddress, addressType, getStakeFromAny,init } from '../index';
import {Client} from 'pg'

const validBech32Addrs = [
  "stake1uxyldhxclla0fpltcgjkak567hy93nm44vq6vxqryy9trtsv3mhl9",
  "addr1q88gjeh65yu9dvnjg3nguakq4aw9wgmcslnehpsvvvsqf0ww39n04gfc26e8y3rx3emvpt6u2u3h3pl8nwrqcceqqj7sgrrgdp",
  "stake1u88gjeh65yu9dvnjg3nguakq4aw9wgmcslnehpsvvvsqf0gsye9ex"
];

const validHexAddrs = [
  "01ce8966faa13856b27244668e76c0af5c57237887e79b860c632004bdce8966faa13856b27244668e76c0af5c57237887e79b860c632004bd",
  "e1ce8966faa13856b27244668e76c0af5c57237887e79b860c632004bd"
]
const invalidHexAddrs = [
  "z1ce8966faa13856b27244668e76c0af5c57237887e79b860c632004bdce8966faa13856b27244668e76c0af5c57237887e79b860c632004bd"
];

const invalidBech32Addrs = [
  
  // Bech32 is valid, but address is not Cardano:
    "A12UEL5L",
    "a12uel5l",
    "an83characterlonghumanreadablepartthatcontainsthenumber1andtheexcludedcharactersbio1tt5tgs",
    "abcdef1qpzry9x8gf2tvdw0s3jn54khce6mua7lmqqqxw",
    "11qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqc8247j",
    "split1checkupstagehandshakeupstreamerranterredcaperred2y9e3w",
    "?1ezyfcl",


  // Bech32m is valid, but address is not Cardano
    "A1LQFN3A",
    "a1lqfn3a",
    "an83characterlonghumanreadablepartthatcontainsthetheexcludedcharactersbioandnumber11sg7hg6",
    "abcdef1l7aum6echk45nj3s0wdvt2fg8x9yrzpqzd3ryx",
    "11llllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllludsr8",
    "split1checkupstagehandshakeupstreamerranterredcaperredlc445v",
    "?1v759aa",



    // Invalid bech32:
    " 1nwldj5",          //# HRP character out of range
    "\x7F" + "1axkwrx",  //# HRP character out of range
    "\x80" + "1eym55h",  //# HRP character out of range
                        //# overall max length exceeded
    "an84characterslonghumanreadablepartthatcontainsthenumber1andtheexcludedcharactersbio1569pvx",
    "pzry9x0s0muk",      //# No separator character
    "1pzry9x0s0muk",     //# Empty HRP
    "x1b4n0q5v",         //# Invalid data character
    "li1dgmt3",          //# Too short checksum
    "de1lg7wt" + "\xFF", //# Invalid character in checksum
    "A1G7SGD8",          //# checksum calculated with uppercase form of HRP
    "10a06t8",           //# empty HRP
    "1qzzfhee",          //# empty HRP

    // Invalid bech32m
    " 1xj0phk",          //# HRP character out of range
    "\x7F" + "1g6xzxy",  //# HRP character out of range
    "\x80" + "1vctc34",  //# HRP character out of range
                          //# overall max length exceeded
    "an84characterslonghumanreadablepartthatcontainsthetheexcludedcharactersbioandnumber11d6pts4",
    "qyrz8wqd2c9m",      //# No separator character
    "1qyrz8wqd2c9m",     //# Empty HRP
    "y1b0jsk6g",         //# Invalid data character
    "lt1igcx5c0",        //# Invalid data character
    "in1muywd",          //# Too short checksum
    "mm1crxm3i",         //# Invalid character in checksum
    "au1s5cgom",         //# Invalid character in checksum
    "M1VUXWEZ",          //# Checksum calculated with uppercase form of HRP
    "16plkw9",           //# Empty HRP
    "1p2gdwpf",          //# Empty HRP

    // Bitcoin addresses:
    "BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4",
    "tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7",
    "bc1pw508d6qejxtdg4y5r3zarvary0c5xw7kw508d6qejxtdg4y5r3zarvary0c5xw7kt5nd6y",
    "BC1SW50QGDZ25J",
    "bc1zw508d6qejxtdg4y5r3zarvaryvaxxpcs", 
    "tb1qqqqqp399et2xygdj5xreqhjjvcmzhxw4aywxecjdzew6hylgvsesrxh6hy",
    "tb1pqqqqp399et2xygdj5xreqhjjvcmzhxw4aywxecjdzew6hylgvsesf3hn0c",
    "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0",
]

init("mainnet",new Client({}));

test('Label is CIP68', () => {
  expect(labelIsCIP68(31337)).toBe(false);
  expect(labelIsCIP68(100)).toBe(true);
  expect(labelIsCIP68(222)).toBe(true);
  expect(labelIsCIP68(223)).toBe(false);
});
test('Invalid bech32 addresses', ()=> { 
  for (const a of invalidBech32Addrs) { 
    expect(()=>validBech32Address(a)).toThrow();
  }
});
test('Valid bech32 addresses',() => {
  for (const a of validBech32Addrs) { 
    expect(()=>validBech32Address(a)).toBeTruthy();
  }
});
test('Invalid hex addresses',()=>{
  for (const a of invalidHexAddrs) { 
    expect(()=>validAddress(a)).toThrow();
  }
});
test('Valid hex addresses',()=>{
  for (const a of validHexAddrs) { 
    expect(()=>validAddress(a)).toBeTruthy();
  }
});
test('Get type from any valid address',()=>{ 
  for(const a of [...validBech32Addrs, ...validHexAddrs]) { 
      const d = validAddress(a);
    
      expect(addressType(d.toString())).toMatch(/Stake|Base|Enterprise|Bootstrap|Pointer/);
      
    }
});
test('Get stake from any address',()=>{
  let d, s;
  for(const a of [...validBech32Addrs, ...validHexAddrs]) { 
    expect(()=>d=getStakeFromAny(a)).not.toThrow();
    expect(addressType(getStakeFromAny(a)||'')).toBe('Stake');


  }
})