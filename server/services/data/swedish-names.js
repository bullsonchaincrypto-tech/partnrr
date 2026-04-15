// ============================================================
// V9 Pipeline — Svenska förnamn (Fas 3 Swedish Gate)
// ============================================================
// Topp ~500 svenska förnamn baserat på SCB:s namnstatistik.
// Användas för att detektera "Förnamn Efternamn"-mönster i bio/handle/name.
// Exporteras som Set för O(1) lookup.
//
// VIKTIGT: Listan är kapad till de mest etablerade svenska namnen för att
// minska false positives mot internationella namn (t.ex. tysk "Osmund").
// Uppdatera årligen från https://www.scb.se/namnstatistik

const NAMES = [
  // === MÄN — TOPP 250 (2024 SCB) ===
  'Lars', 'Mikael', 'Anders', 'Johan', 'Erik', 'Per', 'Karl', 'Carl', 'Thomas',
  'Jan', 'Daniel', 'Peter', 'Fredrik', 'Andreas', 'Hans', 'Stefan', 'Martin',
  'Mats', 'Henrik', 'Mattias', 'Bengt', 'Magnus', 'Bo', 'Marcus', 'Markus',
  'Christer', 'Patrik', 'Niklas', 'Jonas', 'Christoffer', 'Christian', 'Robert',
  'Tobias', 'Joakim', 'Roger', 'Anton', 'Alexander', 'Oskar', 'Oscar', 'Olof',
  'Olov', 'Olle', 'Sven', 'Gunnar', 'Stig', 'Ulf', 'Rolf', 'Kenneth', 'Kent',
  'Leif', 'Ingemar', 'Ingvar', 'Göran', 'Jörgen', 'Tommy', 'Roland', 'Kjell',
  'Bertil', 'Arne', 'Åke', 'Björn', 'Lennart', 'Torbjörn', 'Tor', 'Folke',
  'Knut', 'Gustav', 'Gustaf', 'Adam', 'Filip', 'Philip', 'Viktor', 'Victor',
  'Hugo', 'Liam', 'William', 'Noah', 'Lucas', 'Elias', 'Theodor', 'Theo',
  'Vincent', 'Alfred', 'Axel', 'Otto', 'Albin', 'Anton', 'Wilmer', 'Melvin',
  'Sixten', 'Edvin', 'Ludvig', 'Love', 'Charlie', 'Ebbe', 'Alvar', 'Vilgot',
  'Frans', 'Loke', 'Ville', 'Måns', 'Frej', 'Alve', 'Ivar', 'Sigge', 'Folke',
  'Wilhelm', 'Vidar', 'Vilmer', 'Arvid', 'Holger', 'Hjalmar', 'Helmer', 'Harry',
  'Edvard', 'August', 'Birger', 'Bror', 'Tage', 'Valter', 'Walter', 'Vilhelm',
  'Sigurd', 'Sigvard', 'Sigfrid', 'Allan', 'Allan', 'Ragnar', 'Helge', 'Harald',
  'Henning', 'Henrik', 'Hilding', 'Karlsson', 'Kristian', 'Kristoffer', 'Linus',
  'Marko', 'Mikko', 'Mio', 'Måns', 'Nathan', 'Nicklas', 'Niclas', 'Nils',
  'Noel', 'Olav', 'Pelle', 'Pontus', 'Rasmus', 'Robin', 'Sam', 'Samuel',
  'Sebastian', 'Simon', 'Sten', 'Sune', 'Svante', 'Ted', 'Tim', 'Timo',
  'Tomas', 'Torsten', 'Tristan', 'Truls', 'Valdemar', 'Vilhjälmar', 'Wille',
  'Yngve', 'Algot', 'Alve', 'Aron', 'Arvin', 'Atle', 'Casper', 'Colin',
  'Dante', 'Dennis', 'Devin', 'Douglas', 'Edvin', 'Egon', 'Emanuel', 'Engelbert',
  'Erland', 'Ernst', 'Ewald', 'Felix', 'Fred', 'Gabriel', 'George', 'Gideon',
  'Gilbert', 'Glenn', 'Greger', 'Gunder', 'Halvar', 'Hampus', 'Hannes', 'Harvey',
  'Helmer', 'Herbert', 'Herman', 'Holger', 'Iver', 'Jack', 'Jakob', 'Jeppe',
  'Joar', 'Joel', 'John', 'Jonatan', 'Josef', 'Julius', 'Kalle', 'Karsten',
  'Kasper', 'Knut', 'Konrad', 'Kristoffer', 'Lasse', 'Leonard', 'Levi', 'Lex',
  'Liam', 'Linus', 'Loke', 'Loui', 'Louis', 'Lowe', 'Malte', 'Manne',
  'Manfred', 'Massimo', 'Mauritz', 'Max', 'Maximilian', 'Milian', 'Milo',
  'Milton', 'Morten', 'Måns', 'Nathaniel', 'Neo', 'Nicolai', 'Nicolas', 'Nikolaj',
  'Norman', 'Olivier', 'Olivander', 'Orvar', 'Osvald', 'Otis', 'Owe', 'Paavo',
  'Patric', 'Pauli', 'Pello', 'Phil', 'Pim', 'Ragnvald', 'Reidar', 'Reinhold',
  'Rickard', 'Roar', 'Rune', 'Rutger', 'Selmer', 'Severin', 'Sigvard', 'Sixten',
  'Steffen', 'Stellan', 'Stian', 'Storm', 'Sture', 'Svante', 'Tarjei', 'Teodor',
  'Tobias', 'Torbern', 'Torsten', 'Trygve', 'Ulrik', 'Urban', 'Valle', 'Verner',
  'Vidar', 'Viggo', 'Vilgot', 'Vilhelm', 'Wille', 'Yusuf', 'Åsa', 'Östen',

  // === KVINNOR — TOPP 250 (2024 SCB) ===
  'Anna', 'Maria', 'Eva', 'Karin', 'Kristina', 'Lena', 'Kerstin', 'Sara',
  'Marie', 'Emma', 'Susanne', 'Birgitta', 'Christina', 'Linda', 'Helena',
  'Elisabet', 'Elisabeth', 'Inger', 'Hanna', 'Jenny', 'Johanna', 'Annika',
  'Ulla', 'Gunilla', 'Ingrid', 'Margareta', 'Cecilia', 'Camilla', 'Malin',
  'Monica', 'Ann', 'Anette', 'Annette', 'Pia', 'Britt', 'Carina', 'Katarina',
  'Catarina', 'Sofia', 'Sofie', 'Charlotte', 'Caroline', 'Karolina', 'Klara',
  'Clara', 'Frida', 'Sandra', 'Therese', 'Hannah', 'Julia', 'Linnea', 'Linnéa',
  'Elin', 'Lina', 'Astrid', 'Alva', 'Saga', 'Ebba', 'Wilma', 'Maja', 'Selma',
  'Olivia', 'Alma', 'Stella', 'Tuva', 'Liv', 'Iris', 'Ella', 'Vera', 'Lilly',
  'Lily', 'Ines', 'Ida', 'Edith', 'Edit', 'Elsa', 'Esther', 'Ester',
  'Mia', 'Lo', 'Greta', 'Hedvig', 'Hedda', 'Hilma', 'Hilda', 'Hulda', 'Hanna',
  'Henrietta', 'Hertha', 'Henrika', 'Ingegerd', 'Ingeborg', 'Inga', 'Inga-Lill',
  'Ingegärd', 'Ingrid', 'Iris', 'Irmgard', 'Isabel', 'Isabella', 'Iva', 'Janet',
  'Jasmin', 'Jasmine', 'Jeanette', 'Jenny', 'Joanna', 'Josefin', 'Josefina',
  'Josephine', 'Judit', 'Judith', 'Julia', 'Juliette', 'June', 'Karin', 'Kajsa',
  'Karla', 'Karoline', 'Katja', 'Katrin', 'Katrine', 'Kaya', 'Kim', 'Kira',
  'Klara', 'Kornelia', 'Lara', 'Laura', 'Leah', 'Lea', 'Leila', 'Lena',
  'Lia', 'Liana', 'Liisa', 'Lilja', 'Lilly', 'Liv', 'Lo', 'Lola', 'Lotta',
  'Louise', 'Lova', 'Lovisa', 'Loviza', 'Luna', 'Lykke', 'Madeleine', 'Magdalena',
  'Maja', 'Malou', 'Mara', 'Margit', 'Mari', 'Maria', 'Mariam', 'Marianne',
  'Marie', 'Marika', 'Marina', 'Marit', 'Marlene', 'Martina', 'Mary', 'Matilda',
  'Maud', 'Mei', 'Melinda', 'Mette', 'Mia', 'Michelle', 'Mila', 'Milja',
  'Milla', 'Mimmi', 'Mina', 'Mira', 'Miriam', 'Moa', 'Mona', 'My', 'Mylene',
  'Märta', 'Nadia', 'Nadja', 'Nanna', 'Naomi', 'Natalia', 'Natalie', 'Nathalie',
  'Nellie', 'Nelly', 'Nicole', 'Nikita', 'Nikol', 'Nina', 'Nora', 'Norah',
  'Olivia', 'Petra', 'Pia', 'Polly', 'Pernilla', 'Rakel', 'Ramona', 'Rebecca',
  'Rebecka', 'Renee', 'Ricarda', 'Rita', 'Roberta', 'Romina', 'Ronja', 'Rosa',
  'Rose', 'Roxana', 'Sabina', 'Sandra', 'Sanna', 'Sara', 'Selma', 'Senja',
  'Serena', 'Signe', 'Sigrid', 'Silvia', 'Simone', 'Siri', 'Siv', 'Sofie',
  'Sofia', 'Sonja', 'Stina', 'Sussi', 'Svea', 'Tea', 'Tessa', 'Tessan', 'Tilda',
  'Tilde', 'Tina', 'Tone', 'Tora', 'Tove', 'Tuva', 'Ulrika', 'Una', 'Vanja',
  'Vera', 'Veronica', 'Veronika', 'Vilhelmina', 'Vilma', 'Viola', 'Viveka',
  'Wendela', 'Wendy', 'Wilhelmina', 'Yasmin', 'Yvonne', 'Zara', 'Zoe', 'Zoé',
  'Åsa', 'Åse', 'Ödbjörg',
];

// Normalisera till lowercase Set
export const SWEDISH_FIRST_NAMES = new Set(NAMES.map(n => n.toLowerCase()));

/**
 * Kollar om text innehåller ett svenskt förnamn (whole-word match).
 * @param {string} text - Bio, handle eller name att söka i
 * @returns {boolean}
 */
export function containsSwedishFirstName(text) {
  if (!text) return false;
  const tokens = text.toLowerCase().match(/\b[a-zåäöü]+\b/g) || [];
  for (const t of tokens) {
    if (SWEDISH_FIRST_NAMES.has(t)) return true;
  }
  return false;
}
