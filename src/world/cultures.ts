// Names that sound like they belong somewhere: each culture has a list of real place names (and
// given names) that trains a small character Markov model, plus the words its maps tend to add
// ("Rio …", "… River", "Mount …", "…stan"). `guessCulture` picks a sensible one for a spot on Earth.

export type NameKind = 'country' | 'city' | 'region' | 'river' | 'mountain' | 'person';

export const NAME_KINDS: { id: NameKind; label: string }[] = [
  { id: 'country', label: 'Country' },
  { id: 'region', label: 'Region' },
  { id: 'city', label: 'City' },
  { id: 'river', label: 'River' },
  { id: 'mountain', label: 'Mountain' },
  { id: 'person', label: 'Person' },
];

/**
 * How a kind of name is dressed: `forms` are templates where `{}` is the generated name (glued
 * when written next to letters, as in "{}stan" or "Kara{}") and, for people, `{s}` is a family
 * name. A form is used with probability `chance`, otherwise the bare name.
 */
export interface Forms {
  chance: number;
  forms: string[];
}

export interface Culture {
  id: string;
  label: string;
  /** Real place names that teach the model how this culture's names sound. */
  places: string[];
  /** Given names; people fall back to place names when absent. */
  people?: string[];
  /** Fixed family names; otherwise family names are generated from the place names. */
  surnames?: string[];
  kinds?: Partial<Record<NameKind, Forms>>;
}

const w = (s: string) => s.split(/\s+/).filter(Boolean);

export const CULTURES: Culture[] = [
  {
    id: 'latin',
    label: 'Latin',
    places: w(`Roma Mediolanum Verona Ravenna Capua Florentia Aquileia Brundisium Tarentum Neapolis Ostia Pisae Genua
      Placentia Cremona Mantua Patavium Ancona Ariminum Bononia Perusia Arretium Lugdunum Narbo Tarraco Emerita Hispalis
      Corduba Toletum Valentia Carthago Utica Lutetia Augusta Treveri Colonia Moguntiacum Vindobona Aquincum Sirmium Salona
      Londinium Eboracum Burdigala Tolosa Nemausus Arelate Massilia Antipolis Segusio Novaria Comum Tergeste Iader Firmum
      Asculum Spoletium Tusculum Praeneste Tibur Aricia Lavinium Sicilia Calabria Apulia Lucania Campania Etruria Umbria
      Liguria Raetia Noricum Pannonia Dalmatia Moesia Dacia Thracia Lusitania Baetica Gallia Germania Britannia Aquitania
      Hispania Numidia Mauretania`),
    people: w(`Marcus Gaius Lucius Titus Quintus Publius Aulus Decimus Sextus Gnaeus Servius Tiberius Claudius Julia Livia
      Cornelia Octavia Aurelia Flavia Valeria Antonia Lucilla Marcella Severus Maximus Felix Valerius Aurelius Cassius
      Drusus Agrippa Camilla Sabina Domitia Lucretia Paulina Fabia Horatius Septimus`),
    kinds: {
      country: { chance: 0.35, forms: ['{}ia', 'Republic of {}', 'Imperium of {}'] },
      region: { chance: 0.3, forms: ['{}ia', '{}ica'] },
      river: { chance: 0.9, forms: ['{} River', 'Flumen {}'] },
      mountain: { chance: 0.9, forms: ['Mons {}', 'Monte {}', '{} Mountains'] },
      person: { chance: 0.6, forms: ['{} {s}ius', '{} {s}us'] },
    },
  },
  {
    id: 'french',
    label: 'French',
    places: w(`Paris Lyon Marseille Bordeaux Toulouse Nantes Rennes Lille Rouen Amiens Reims Troyes Dijon Besancon Grenoble
      Chambery Annecy Valence Avignon Nimes Montpellier Perpignan Carcassonne Narbonne Beziers Albi Rodez Cahors Perigueux
      Limoges Poitiers Angers Tours Orleans Blois Chartres Versailles Fontainebleau Auxerre Nevers Bourges Vichy Clermont
      Aurillac Montauban Bayonne Biarritz Pau Tarbes Lourdes Agen Arcachon Cognac Saintes Niort Vannes Lorient Quimper
      Morlaix Dinan Laval Caen Bayeux Cherbourg Dieppe Calais Boulogne Arras Cambrai Valenciennes Sedan Verdun Metz Nancy
      Epinal Colmar Strasbourg Mulhouse Belfort Macon Roanne Vienne Montelimar Orange Arles Toulon Cannes Antibes Grasse
      Menton Beaune Chalon Sens Meaux Senlis Compiegne Soissons Laon`),
    people: w(`Jean Pierre Louis Henri Philippe Charles Francois Jacques Antoine Etienne Guillaume Nicolas Olivier Thibault
      Gaston Rene Marcel Lucien Benoit Hugues Marie Jeanne Marguerite Isabelle Catherine Louise Claire Sophie Helene
      Madeleine Genevieve Agnes Blanche Colette Elise Amelie Brigitte Odile Juliette Margot`),
    kinds: {
      country: { chance: 0.3, forms: ['{}ie', 'Royaume de {}', 'Republique de {}'] },
      region: { chance: 0.3, forms: ['{}ais', '{}ois', 'Pays de {}'] },
      city: { chance: 0.25, forms: ['Saint-{}', '{}-sur-Mer', '{}ville', '{}court'] },
      river: { chance: 0.7, forms: ['{} River', 'La {}'] },
      mountain: { chance: 0.9, forms: ['Mont {}', 'Massif du {}', 'Pic de {}'] },
      person: { chance: 0.6, forms: ['{} de {s}', '{} {s}'] },
    },
  },
  {
    id: 'germanic',
    label: 'Germanic',
    places: w(`Berlin Hamburg Bremen Hannover Braunschweig Magdeburg Leipzig Dresden Chemnitz Erfurt Weimar Jena Gotha
      Kassel Fulda Frankfurt Mainz Wiesbaden Darmstadt Mannheim Heidelberg Karlsruhe Stuttgart Tubingen Ulm Augsburg Munchen
      Regensburg Passau Nurnberg Bamberg Wurzburg Bayreuth Ingolstadt Landshut Rosenheim Salzburg Innsbruck Linz Graz
      Klagenfurt Bregenz Konstanz Freiburg Offenburg Pforzheim Heilbronn Koblenz Trier Bonn Koln Dusseldorf Duisburg Essen
      Dortmund Bochum Munster Bielefeld Paderborn Osnabruck Oldenburg Emden Kiel Lubeck Rostock Schwerin Wismar Stralsund
      Greifswald Potsdam Cottbus Gorlitz Halle Dessau Wittenberg Goslar Hildesheim Gottingen Marburg Giessen Siegen
      Wolfsburg Lauenburg Rothenburg Nordlingen Kempten Lindau Starnberg Friedberg Waldeck Arnsberg Falkenstein Rabenau`),
    people: w(`Friedrich Wilhelm Heinrich Otto Karl Ludwig Konrad Albrecht Siegfried Gunther Dietrich Lothar Rudolf Bernhard
      Gerhard Ulrich Walther Eberhard Hartmann Leopold Matthias Johann Klaus Gretchen Hildegard Brunhilde Gertrud Mathilde
      Adelheid Liesel Elisabeth Kunigunde Irmgard Ottilie Friederike Hedwig Sophia Katharina Ursula Wilhelmina`),
    kinds: {
      country: { chance: 0.35, forms: ['{}land', '{}ia', '{}reich', 'Kingdom of {}'] },
      region: { chance: 0.4, forms: ['{}gau', '{}mark', '{}land', 'Ober{}'] },
      city: { chance: 0.3, forms: ['{}burg', '{}stadt', 'Bad {}', '{}heim', '{}dorf'] },
      river: { chance: 0.7, forms: ['{} River', '{}bach'] },
      mountain: { chance: 0.9, forms: ['{}berg', '{} Mountains', '{}horn', '{} Alps'] },
      person: { chance: 0.6, forms: ['{} von {s}', '{} {s}'] },
    },
  },
  {
    id: 'english',
    label: 'English',
    places: w(`London York Bristol Bath Oxford Cambridge Norwich Ipswich Colchester Canterbury Dover Brighton Winchester
      Salisbury Exeter Plymouth Gloucester Worcester Hereford Shrewsbury Chester Lancaster Preston Liverpool Manchester
      Sheffield Leeds Bradford Durham Newcastle Carlisle Kendal Whitby Scarborough Lincoln Nottingham Derby Leicester Coventry
      Birmingham Wolverhampton Stafford Northampton Bedford Luton Reading Guildford Maidstone Rochester Hastings Chichester
      Portsmouth Southampton Bournemouth Dorchester Taunton Wells Swindon Banbury Stamford Peterborough Huntingdon Ely
      Lowestoft Yarmouth Grimsby Hull Beverley Ripon Harrogate Skipton Halifax Wakefield Barnsley Doncaster Rotherham
      Mansfield Ashford Sandwich Ashbourne Ludlow Kingsbridge Thornbury Ashby Wetherby`),
    people: w(`William John Thomas Edward Henry Richard Robert Geoffrey Walter Hugh Roger Simon Stephen Arthur George Alfred
      Edmund Harold Oliver Samuel Mary Elizabeth Anne Margaret Alice Eleanor Matilda Emma Edith Agnes Joan Catherine Rose
      Jane Charlotte Harriet Beatrice Florence Grace Lucy`),
    kinds: {
      country: { chance: 0.3, forms: ['{}land', 'Kingdom of {}', 'Commonwealth of {}'] },
      region: { chance: 0.4, forms: ['{}shire', 'North {}', 'West {}', '{} Downs'] },
      city: { chance: 0.3, forms: ['{}ton', '{}ford', 'New {}', '{}bury', 'Port {}'] },
      river: { chance: 0.9, forms: ['{} River', 'River {}'] },
      mountain: { chance: 0.9, forms: ['Mount {}', '{} Hills', '{} Fell'] },
      person: { chance: 0.8, forms: ['{} {s}'] },
    },
  },
  {
    id: 'norse',
    label: 'Norse',
    places: w(`Oslo Bergen Trondheim Stavanger Tromso Bodo Narvik Alesund Molde Kristiansand Arendal Larvik Drammen Hamar
      Lillehammer Gjovik Roros Voss Flam Stockholm Uppsala Gavle Sundsvall Umea Lulea Kiruna Ostersund Falun Orebro Vasteras
      Linkoping Norrkoping Jonkoping Vaxjo Kalmar Visby Malmo Lund Helsingborg Halmstad Goteborg Uddevalla Karlstad Kobenhavn
      Aarhus Odense Aalborg Esbjerg Ribe Roskilde Viborg Randers Kolding Vejle Horsens Skagen Reykjavik Akureyri Husavik
      Isafjordur Selfoss Hafnarfjordur Thorshavn Klaksvik Hedeby Birka Kaupang Sigtuna Jelling Trelleborg Skara Nidaros
      Hladir Lindholm Tunsberg`),
    people: w(`Erik Olaf Harald Sigurd Ragnar Bjorn Leif Sven Thorvald Gunnar Halfdan Ivar Knut Magnus Egil Ulf Arne Einar
      Thorstein Hakon Ingrid Astrid Sigrid Freydis Gudrun Helga Ragnhild Thora Ylva Solveig Asa Gunnhild Brynja Tove Liv
      Signy Thyra Alfhild Dagny Hilde`),
    kinds: {
      country: { chance: 0.4, forms: ['{}heim', '{}land', '{}gard', 'Realm of {}'] },
      region: { chance: 0.4, forms: ['{}mark', '{}fjord', '{}dal', '{}land'] },
      city: { chance: 0.35, forms: ['{}vik', '{}by', '{}havn', '{}stad'] },
      river: { chance: 0.8, forms: ['{}elva', '{} River', '{}a'] },
      mountain: { chance: 0.9, forms: ['{}fjell', '{}tind', 'Mount {}'] },
      person: { chance: 0.7, forms: ['{} {s}sson', '{} {s}'] },
    },
  },
  {
    id: 'celtic',
    label: 'Celtic',
    places: w(`Dublin Galway Limerick Kilkenny Killarney Sligo Donegal Derry Armagh Tralee Wexford Wicklow Kildare Athlone
      Ennis Clonmel Dundalk Drogheda Mullingar Tullamore Carlow Letterkenny Ballina Castlebar Westport Clifden Dingle Kinsale
      Bantry Inverness Aberdeen Dundee Perth Stirling Oban Portree Kirkwall Lerwick Dunkeld Pitlochry Aviemore Braemar
      Kilmarnock Ayr Dumfries Dunbar Arbroath Montrose Elgin Nairn Wick Thurso Ullapool Tobermory Cardiff Swansea
      Aberystwyth Bangor Caernarfon Conwy Llandudno Llangollen Machynlleth Carmarthen Pembroke Brecon Merthyr Penzance
      Kemper Karaez Gwened Lannion Tintagel Glendalough Ardmore Kilcullen`),
    people: w(`Brian Conor Cormac Aidan Ciaran Declan Donal Fergus Finn Niall Oisin Ronan Seamus Lachlan Angus Duncan
      Malcolm Kenneth Alasdair Rhys Dafydd Gwyn Owain Bran Siobhan Aoife Niamh Brigid Deirdre Eithne Grainne Maeve Orla
      Sinead Isla Morag Ailsa Gwen Rhiannon Bronwen Ceridwen`),
    kinds: {
      country: { chance: 0.25, forms: ['{}ia', 'Kingdom of {}'] },
      region: { chance: 0.4, forms: ['Glen {}', 'Strath{}', '{}shire'] },
      city: { chance: 0.4, forms: ['Kil{}', 'Bally{}', 'Aber{}', 'Inver{}', 'Dun{}', 'Llan{}'] },
      river: { chance: 0.9, forms: ['River {}', '{} Water'] },
      mountain: { chance: 0.9, forms: ['Ben {}', 'Slieve {}', '{} Hills'] },
      person: { chance: 0.6, forms: ['{} mac {s}', '{} ap {s}', '{} {s}'] },
    },
  },
  {
    id: 'slavic',
    label: 'Slavic',
    places: w(`Moskva Kyiv Minsk Warszawa Krakow Gdansk Poznan Wroclaw Lodz Lublin Katowice Szczecin Bydgoszcz Torun Praha
      Brno Ostrava Plzen Olomouc Bratislava Kosice Zilina Ljubljana Maribor Zagreb Split Zadar Osijek Beograd Novisad Nis
      Kragujevac Sarajevo Mostar Podgorica Skopje Ohrid Sofia Plovdiv Varna Burgas Ruse Smolensk Tver Vladimir Suzdal
      Yaroslavl Kostroma Novgorod Pskov Vologda Tula Ryazan Kaluga Bryansk Kursk Voronezh Tambov Penza Saratov Samara
      Volgograd Rostov Krasnodar Sochi Lviv Odesa Kharkiv Poltava Chernihiv Zhytomyr Vinnytsia Rivne Lutsk Ternopil
      Uzhhorod Grodno Vitebsk Mogilev Gomel Pinsk Polotsk Bobruisk`),
    people: w(`Ivan Dmitri Vladimir Boris Igor Oleg Yaroslav Sviatoslav Mstislav Vsevolod Stanislav Kazimierz Bogdan Miroslav
      Radomir Zdenek Vaclav Milos Dragan Lech Pavel Mikhail Anastasia Olga Lyudmila Svetlana Tatiana Natalia Yelena Vera
      Nadezhda Milena Zorya Jadwiga Agnieszka Bozena Dragana Mila Vesna Darina Zlata`),
    kinds: {
      country: { chance: 0.35, forms: ['{}ia', 'Tsardom of {}', 'Grand Principality of {}'] },
      region: { chance: 0.3, forms: ['{}ia', '{}shchina', 'Zemlya {}'] },
      city: { chance: 0.35, forms: ['{}grad', '{}ovo', '{}sk', 'Novo{}', '{}ov'] },
      river: { chance: 0.8, forms: ['{} River', 'Reka {}'] },
      mountain: { chance: 0.9, forms: ['Gora {}', '{} Mountains'] },
      person: { chance: 0.6, forms: ['{} {s}ov', '{} {s}ski', '{} {s}ich'] },
    },
  },
  {
    id: 'greek',
    label: 'Greek',
    places: w(`Athina Thessaloniki Patra Larisa Volos Ioannina Kavala Serres Drama Kozani Kastoria Florina Veria Edessa
      Katerini Lamia Chalkida Thiva Livadia Delphi Nafplio Argos Korinthos Sparti Kalamata Pylos Olympia Pyrgos Tripoli
      Megalopoli Mykonos Naxos Paros Santorini Milos Syros Tinos Andros Kythira Rodos Kos Patmos Samos Chios Lesvos Lemnos
      Thasos Kerkyra Lefkada Ithaki Kefalonia Zakynthos Chania Rethymno Heraklion Knossos Mycenae Tiryns Epidavros Marathon
      Eretria Dodona Pella Vergina Amphipolis Philippi Abdera Byzantion Smyrni Ephesos Miletos Halikarnassos Pergamon Troia
      Sinope Trapezous Massalia Syrakousai Akragas Taras`),
    people: w(`Alexandros Nikolaos Dimitrios Georgios Konstantinos Ioannis Theodoros Andreas Christos Stavros Spyros
      Leonidas Perikles Sokrates Themistokles Achilleas Odysseas Aristides Kleon Philippos Eleni Maria Sofia Katerina
      Despina Zoe Irini Penelope Kalliope Ariadne Daphne Theodora Xanthe Chrysa Foteini Melina Thalia Ourania`),
    kinds: {
      country: { chance: 0.3, forms: ['{}ia', '{}is', 'Kingdom of {}'] },
      region: { chance: 0.35, forms: ['{}ia', '{}is', '{}ika'] },
      city: { chance: 0.3, forms: ['{}polis', 'Nea {}', 'Ano {}'] },
      river: { chance: 0.85, forms: ['{} River', 'Potamos {}'] },
      mountain: { chance: 0.9, forms: ['Mount {}', 'Oros {}'] },
      person: { chance: 0.6, forms: ['{} {s}opoulos', '{} {s}idis', '{} {s}akis'] },
    },
  },
  {
    id: 'arabic',
    label: 'Arabic',
    places: w(`Makkah Madinah Jeddah Riyadh Dammam Taif Tabuk Hail Najran Jizan Abha Buraydah Sanaa Aden Taizz Mukalla
      Muscat Sohar Nizwa Salalah Dubai Sharjah Ajman Fujairah Doha Manama Kuwait Basra Baghdad Mosul Kirkuk Najaf Karbala
      Samarra Tikrit Dimashq Halab Homs Hama Latakia Tartus Raqqa Bayrut Saida Tarabulus Amman Irbid Zarqa Aqaba Karak
      Madaba Jarash Gaza Nablus Yafa Haifa Akka Qahira Iskandariyya Aswan Asyut Tanta Mansura Dumyat Suez Benghazi Misrata
      Sirt Tubruq Tunis Sfax Sousse Qayrawan Bizerte Gabes Tlemcen Wahran Qasantina Annaba Biskra Ghardaia Fas Marrakesh
      Miknas Rabat Agadir Tanja Tetouan Oujda Nouakchott Khartoum`),
    people: w(`Muhammad Ahmad Ali Hasan Husayn Umar Uthman Khalid Tariq Yusuf Ibrahim Ismail Hamza Faisal Salah Karim
      Rashid Said Mahmud Nasir Fatima Aisha Khadija Maryam Zaynab Layla Amira Salma Huda Nour Yasmin Rania Samira Hana
      Dalia Farah Jamila Lubna Najla Safiya`),
    kinds: {
      country: { chance: 0.4, forms: ['Al {}', 'Sultanate of {}', 'Emirate of {}', '{}iya'] },
      region: { chance: 0.4, forms: ['Wadi {}', 'Bilad {}', '{}iya'] },
      city: { chance: 0.35, forms: ['Al {}', 'Madinat {}', 'Qasr {}', 'Bir {}', 'Ras {}'] },
      river: { chance: 0.9, forms: ['Wadi {}', 'Nahr {}'] },
      mountain: { chance: 0.9, forms: ['Jabal {}', '{} Mountains'] },
      person: { chance: 0.7, forms: ['{} ibn {s}', '{} al-{s}'] },
    },
  },
  {
    id: 'persian',
    label: 'Persian',
    places: w(`Tehran Mashhad Isfahan Shiraz Tabriz Qom Ahvaz Kermanshah Kerman Yazd Rasht Sari Gorgan Zanjan Qazvin
      Hamadan Arak Khorramabad Ilam Bushehr Bandar Zahedan Birjand Semnan Kashan Neyshabur Sabzevar Tus Bukhara Samarkand
      Khiva Merv Herat Kabul Kandahar Balkh Mazar Ghazni Bamiyan Jalalabad Kunduz Badakhshan Khorasan Persepolis Pasargadae
      Susa Ecbatana Ctesiphon Hormuz Kish Qeshm Chabahar Dezful Shushtar Bam Jiroft Maragheh Ardabil Urmia Sanandaj Marivan
      Damghan Shahrud Firuzabad Darab Lar Fasa Kazerun Golpayegan Natanz Abarkuh Nain Ardakan`),
    people: w(`Dariush Kourosh Khashayar Ardeshir Bahram Rostam Sohrab Jamshid Fereydun Kaveh Arash Babak Hormoz Shapur
      Mehrdad Farhad Kambiz Siavash Navid Omid Roxana Shirin Parisa Laleh Mahsa Nasrin Soraya Yasaman Azadeh Fereshteh
      Golnar Mitra Anahita Parvaneh Shahrzad Simin Taraneh Ziba Leila Darya`),
    kinds: {
      country: { chance: 0.4, forms: ['{}an', '{}stan', 'Shahdom of {}'] },
      region: { chance: 0.4, forms: ['{}stan', '{}an'] },
      city: { chance: 0.35, forms: ['{}abad', '{}shahr', 'Bandar {}', '{}kand'] },
      river: { chance: 0.9, forms: ['Rud-e {}', '{} River'] },
      mountain: { chance: 0.9, forms: ['Kuh-e {}', '{} Mountains'] },
      person: { chance: 0.6, forms: ['{} {s}i', '{} {s}'] },
    },
  },
  {
    id: 'turkic',
    label: 'Turkic',
    places: w(`Istanbul Ankara Izmir Bursa Antalya Konya Adana Kayseri Samsun Trabzon Erzurum Sivas Malatya Elazig
      Diyarbakir Gaziantep Mersin Eskisehir Denizli Manisa Aydin Mugla Bodrum Edirne Tekirdag Canakkale Balikesir Kutahya
      Afyon Isparta Burdur Nigde Aksaray Kirsehir Yozgat Corum Amasya Tokat Ordu Giresun Rize Artvin Kars Igdir Van Bitlis
      Almaty Astana Shymkent Karaganda Aktobe Atyrau Taraz Pavlodar Semey Oskemen Bishkek Osh Karakol Naryn Talas Tashkent
      Andijan Namangan Fergana Termez Nukus Ashgabat Turkmenabat Dashoguz Baku Ganja Sumgait Shaki Lankaran Kazan Ufa
      Yakutsk Kyzyl Karakorum Otuken`),
    people: w(`Timur Osman Orhan Murad Bayezid Mehmed Selim Suleyman Alp Arslan Tugrul Kemal Bulent Emre Kaan Baris Ercan
      Ilhan Batu Nurlan Askar Yerlan Aybek Bekzat Aisulu Aigerim Dana Gulnara Zeynep Elif Ayse Emine Hatice Leyla Nilufer
      Selin Defne Esra Aylin Gulsen`),
    kinds: {
      country: { chance: 0.45, forms: ['{}stan', '{} Khanate', 'Khaganate of {}', '{}ia'] },
      region: { chance: 0.35, forms: ['{} Steppe', '{}eli'] },
      city: { chance: 0.35, forms: ['{}kent', '{}balik', '{}abad', 'Kara{}', 'Ak{}'] },
      river: { chance: 0.9, forms: ['{} Darya', '{} River', '{}su'] },
      mountain: { chance: 0.9, forms: ['{} Dag', '{} Tau', 'Ala {}'] },
      person: { chance: 0.6, forms: ['{} {s}oglu', '{} {s}'] },
    },
  },
  {
    id: 'indic',
    label: 'Indic',
    places: w(`Delhi Agra Jaipur Jodhpur Udaipur Bikaner Ajmer Pushkar Kota Bundi Gwalior Indore Bhopal Ujjain Jabalpur
      Raipur Nagpur Pune Nashik Kolhapur Solapur Mumbai Surat Vadodara Rajkot Bhavnagar Dwarka Somnath Lucknow Kanpur
      Varanasi Prayagraj Ayodhya Mathura Vrindavan Haridwar Rishikesh Dehradun Patna Gaya Nalanda Vaishali Ranchi Kolkata
      Siliguri Darjeeling Guwahati Shillong Imphal Bhubaneswar Puri Cuttack Konark Warangal Vijayawada Tirupati Chennai
      Madurai Thanjavur Kanchipuram Mysuru Bengaluru Mangaluru Hampi Thrissur Kozhikode Kollam Kathmandu Pokhara Lalitpur
      Bhaktapur Kandy Anuradhapura Galle Jaffna Ujjayini Pataliputra Taxila Kapilavastu Kurukshetra Hastinapura`),
    people: w(`Arjun Rahul Vikram Rohan Aditya Siddharth Rajesh Sanjay Anil Ravi Ashok Chandra Krishna Govind Harsha Kiran
      Nikhil Pranav Rajendra Vijay Priya Ananya Lakshmi Sita Radha Meera Kavya Aishwarya Deepika Divya Gita Indira Kamala
      Lata Nandini Padma Parvati Sunita Uma Vidya`),
    surnames: w(`Sharma Verma Gupta Singh Kumar Patel Rao Reddy Iyer Nair Mehta Joshi Desai Kapoor Malhotra Bose Das Sen
      Banerjee Pillai`),
    kinds: {
      country: { chance: 0.4, forms: ['{}desh', '{} Raj', '{}var', 'Kingdom of {}'] },
      region: { chance: 0.4, forms: ['{}desh', '{} Pradesh', '{}khand'] },
      city: { chance: 0.4, forms: ['{}pur', '{}nagar', '{}abad', '{}garh'] },
      river: { chance: 0.85, forms: ['{} River', '{}nadi'] },
      mountain: { chance: 0.9, forms: ['{} Hills', '{}giri', 'Mount {}'] },
      person: { chance: 0.7, forms: ['{} {s}'] },
    },
  },
  {
    id: 'chinese',
    label: 'Chinese',
    places: w(`Beijing Shanghai Tianjin Chongqing Guangzhou Shenzhen Hangzhou Nanjing Suzhou Wuxi Ningbo Wenzhou Fuzhou
      Xiamen Quanzhou Nanchang Changsha Wuhan Zhengzhou Luoyang Kaifeng Xian Lanzhou Xining Yinchuan Taiyuan Datong
      Shijiazhuang Baoding Jinan Qingdao Yantai Weifang Hefei Wuhu Anqing Guilin Nanning Kunming Dali Lijiang Guiyang
      Chengdu Leshan Mianyang Harbin Changchun Jilin Shenyang Dalian Anshan Hohhot Baotou Haikou Sanya Zhuhai Shantou
      Ganzhou Jiujiang Yichang Xiangyang Handan Tangshan Qinhuangdao Chengde Yangzhou Zhenjiang Changzhou Nantong Xuzhou
      Huaian Shaoxing Jiaxing Huzhou Taizhou Jinhua Lishui Quzhou`),
    people: w(`Wei Fang Jun Lei Ming Hao Jie Tao Yong Qiang Bo Gang Hui Kang Long Peng Bin Chao Feng Zhiwei Xiaoming
      Jianguo Mei Ying Xiu Lan Hua Yan Jing Lian Xia Na Juan Qing Rong Yun Zhen Xiaoyan Meilin Wenjing Haoran Zihan`),
    surnames: w(`Wang Li Zhang Liu Chen Yang Huang Zhao Wu Zhou Xu Sun Ma Zhu Hu Guo He Lin Gao Luo`),
    kinds: {
      country: { chance: 0.3, forms: ['{} Empire', 'Kingdom of {}', '{}guo'] },
      region: { chance: 0.4, forms: ['{} Province', '{}nan', '{}bei'] },
      city: { chance: 0.35, forms: ['{}zhou', '{}cheng', '{}jing', '{}an'] },
      river: { chance: 0.9, forms: ['{} He', '{} Jiang'] },
      mountain: { chance: 0.9, forms: ['{} Shan', 'Mount {}'] },
      person: { chance: 1, forms: ['{s} {}'] },
    },
  },
  {
    id: 'japanese',
    label: 'Japanese',
    places: w(`Tokyo Kyoto Osaka Nara Kobe Yokohama Nagoya Sapporo Sendai Fukuoka Hiroshima Okayama Kagoshima Kumamoto
      Nagasaki Oita Miyazaki Kochi Matsuyama Takamatsu Tokushima Wakayama Tsu Gifu Shizuoka Hamamatsu Kofu Nagano Matsumoto
      Niigata Toyama Kanazawa Fukui Otsu Hikone Himeji Tottori Matsue Izumo Yamaguchi Shimonoseki Saga Karatsu Kitakyushu
      Akita Aomori Morioka Hirosaki Hakodate Otaru Asahikawa Kushiro Obihiro Mito Utsunomiya Maebashi Takasaki Chiba
      Kawagoe Kamakura Odawara Atami Nikko Hakone Ise Kurashiki Onomichi Takayama Shirakawa Kanagawa Yamagata Fukushima Aizu
      Sakata Tsuruoka Iwaki Okinawa Naha`),
    people: w(`Hiroshi Takeshi Kenji Haruki Akira Satoshi Yoshio Masaru Daisuke Ryota Kaito Haruto Sota Yuto Takumi
      Nobunaga Ieyasu Hideyoshi Musashi Kenshin Yuki Sakura Hana Aiko Keiko Yumiko Haruka Akane Emi Naoko Mai Rin Yui
      Hinata Misaki Ayaka Chiyo Tomoe Kaede Nanami`),
    kinds: {
      country: { chance: 0.3, forms: ['Empire of {}', 'Shogunate of {}', '{} Domain'] },
      region: { chance: 0.4, forms: ['{} Province', '{} Prefecture'] },
      city: { chance: 0.3, forms: ['{}machi', '{}mura', '{}shima', '{}yama'] },
      river: { chance: 0.9, forms: ['{}gawa', '{} River'] },
      mountain: { chance: 0.9, forms: ['Mount {}', '{}yama', '{}dake'] },
      person: { chance: 1, forms: ['{s} {}'] },
    },
  },
  {
    id: 'bantu',
    label: 'Bantu',
    places: w(`Mombasa Malindi Lamu Kilifi Nairobi Nakuru Kisumu Eldoret Nyeri Machakos Meru Embu Garissa Kitui Dodoma
      Arusha Moshi Tanga Morogoro Iringa Mbeya Songea Tabora Kigoma Mwanza Bukoba Musoma Shinyanga Singida Mtwara Lindi
      Kilwa Bagamoyo Zanzibar Pemba Unguja Kampala Entebbe Jinja Mbarara Gulu Masaka Kigali Butare Gisenyi Bujumbura Gitega
      Lubumbashi Kisangani Kinshasa Mbandaka Kananga Lusaka Ndola Kitwe Kabwe Lilongwe Blantyre Zomba Mzuzu Harare Bulawayo
      Mutare Gweru Masvingo Maputo Beira Nampula Quelimane Tete Gaborone Maseru Mbabane Manzini Soweto Ulundi Luanda Huambo
      Lubango Malanje`),
    people: w(`Jabari Juma Baraka Kamau Mosi Tumaini Faraji Hamisi Kato Mwangi Otieno Kibet Chege Njoroge Odhiambo Musa
      Bakari Rashidi Zuberi Neema Amani Imani Zawadi Rehema Furaha Nia Wanjiru Akinyi Achieng Nyokabi Makena Nala Zuri
      Halima Mwanaisha Asha Subira Pendo Upendo`),
    kinds: {
      country: { chance: 0.45, forms: ['U{}', 'Bu{}', 'Kingdom of {}'] },
      region: { chance: 0.35, forms: ['Ki{}', 'U{}'] },
      city: { chance: 0.2, forms: ['{}ni', 'Ma{}'] },
      river: { chance: 0.85, forms: ['Mto {}', '{} River'] },
      mountain: { chance: 0.9, forms: ['Mlima {}', 'Mount {}'] },
      person: { chance: 0.6, forms: ['{} {s}'] },
    },
  },
  {
    id: 'nahuatl',
    label: 'Nahuatl',
    places: w(`Tenochtitlan Tlatelolco Texcoco Tlacopan Xochimilco Chapultepec Coyoacan Azcapotzalco Tlaxcala Cholula
      Huejotzingo Tepeaca Tula Tollan Teotihuacan Cuernavaca Cuauhnahuac Tepoztlan Xochicalco Taxco Iguala Tlapa
      Chilpancingo Acapulco Oaxaca Huaxyacac Mitla Tehuantepec Juchitan Coatzacoalcos Tuxtla Tapachula Mazatlan Tlaquepaque
      Zapopan Tonala Colima Zacatecas Jalisco Michoacan Tzintzuntzan Patzcuaro Toluca Tenancingo Malinalco Ocuilan
      Atlacomulco Ixtapan Tepexpan Chalco Amecameca Tlalmanalco Ozumba Mixquic Tlahuac Iztapalapa Culhuacan Tenayuca
      Cuautitlan Zumpango Tizayuca Pachuca Tulancingo Huauchinango Teziutlan Zacatlan Orizaba Cuetlaxtlan Cempoala Papantla
      Tuxpan Xalapa Coatepec Perote Ahuilizapan`),
    people: w(`Cuauhtemoc Moctezuma Itzcoatl Axayacatl Tizoc Ahuitzotl Cuitlahuac Tlacaelel Huitzilihuitl Chimalpopoca
      Acamapichtli Tecuichpo Xochitl Citlali Necahual Yaretzi Izel Nenetl Atzin Coaxoch Papalotl Quetzalli Tlalli Ehecatl
      Tonatiuh Mixtli Ollin Tochtli Yaotl Matlal Cuetlachtli Itzel Miyaotl Necalli Xiuhcoatl Chalchiuitl Eztli Zyanya`),
    kinds: {
      country: { chance: 0.3, forms: ['{}tlan', 'Altepetl of {}', '{}co'] },
      region: { chance: 0.4, forms: ['{}pan', '{}co', '{}tlan'] },
      city: { chance: 0.4, forms: ['{}tepec', '{}co', '{}pan', '{}tlan'] },
      river: { chance: 0.85, forms: ['{}atl', 'Rio {}', '{} River'] },
      mountain: { chance: 0.9, forms: ['{}tepetl', 'Cerro {}', 'Mount {}'] },
      person: { chance: 0.3, forms: ['{} of {s}'] },
    },
  },
  {
    id: 'polynesian',
    label: 'Polynesian',
    places: w(`Honolulu Hilo Kona Lahaina Wailuku Kahului Kailua Kaneohe Waikiki Waimea Hanalei Lihue Kapaa Molokai Lanai
      Kauai Niihau Kahoolawe Oahu Maui Papeete Faaa Punaauia Moorea Raiatea Huahine Tahaa Maupiti Rangiroa Fakarava Nukuhiva
      Hivaoa Rarotonga Aitutaki Mangaia Atiu Apia Savaii Upolu Tutuila Manua Nukualofa Tongatapu Vavau Haapai Eua Funafuti
      Nukulaelae Tokelau Fakaofo Nukunonu Atafu Rotorua Taupo Whanganui Tauranga Whangarei Kaikoura Waitangi Aotearoa
      Rapanui Hangaroa Anakena Mangareva Tubuai Rurutu Rimatara Raivavae Mauke Mitiaro Manihiki Pukapuka Niue Alofi Futuna
      Uvea`),
    people: w(`Kalani Keoni Makoa Kai Koa Ikaika Kekoa Nalu Tane Tangaroa Rangi Tama Manu Tavita Sione Leilani Moana Malia
      Noelani Kailani Hina Mahina Anuhea Lani Iolana Kalea Nani Pua Tiare Vaiana Teuila Mele Sina Hinemoa Aroha Ataahua
      Keala Kanoa Mana Tehani`),
    kinds: {
      country: { chance: 0.2, forms: ['Kingdom of {}', '{} Islands'] },
      region: { chance: 0.3, forms: ['{} Coast', 'Motu {}'] },
      city: { chance: 0.3, forms: ['Wai{}', 'Motu {}', 'Hale{}'] },
      river: { chance: 0.85, forms: ['Wai{}', '{} Stream'] },
      mountain: { chance: 0.9, forms: ['Mauna {}', 'Mount {}'] },
      person: { chance: 0.3, forms: ['{} {s}'] },
    },
  },
  {
    id: 'elvish',
    label: 'Elvish (invented)',
    places: w(`Aelindor Elessia Aelindra Caelorin Elowen Faeloria Galathil Ilvaran Isolinde Lathiriel Lunaveth Maelorien
      Mirethil Naerwen Nimrael Orinthal Quelinor Raenor Sereth Sylvarion Thalorien Ulmeriel Vaelith Valandriel Yliria
      Elunara Aranthil Calithra Eilinel Faelwen Ithilmar Liriandel Melisande Noriel Ellaria Solenna Taliesar Velarin Aelwyn
      Celenor Elarien Faeriel Linalor Maethira Nalorin Olwenna Rivanel Selorin Thiriel Wynorel Ylvalin Amarelle Aurenel
      Lumirel Vanyelle Eldaril Mirawen Sarielle Lorasel Caladwen Silvaneth Iriandor`),
    people: w(`Aerin Caelan Elandor Faelar Galen Ithrin Laeron Mirion Naelor Orin Raelith Saelor Thalion Varion Aeris
      Elowyn Faela Ilyra Lirien Maelis Naeris Saelith Sylvi Arannis Celeste Elyndra Ithriel Lunara Mirael Nimeth Oriel
      Quessa Selwyn Talindra Vaelis Yrael Aelar Calen Riellen`),
    kinds: {
      country: { chance: 0.3, forms: ['Realm of {}', '{}dor', '{}ia'] },
      region: { chance: 0.4, forms: ['{}wood', 'Vale of {}', '{}mere'] },
      city: { chance: 0.3, forms: ['{}ost', '{}thil', '{} Haven'] },
      river: { chance: 0.85, forms: ['{} River', '{}lin', '{}wyn'] },
      mountain: { chance: 0.9, forms: ['{} Peaks', 'Mount {}', '{}taur'] },
      person: { chance: 0.5, forms: ['{} of {s}', '{} {s}'] },
    },
  },
];

const BY_ID = new Map(CULTURES.map((c) => [c.id, c]));
export const cultureById = (id: string): Culture | undefined => BY_ID.get(id);

/** Forms used when a culture does not set its own. */
const DEFAULT_FORMS: Record<NameKind, Forms> = {
  country: { chance: 0.3, forms: ['Kingdom of {}', '{}ia', 'Republic of {}'] },
  region: { chance: 0, forms: [] },
  city: { chance: 0, forms: [] },
  river: { chance: 0.9, forms: ['{} River'] },
  mountain: { chance: 0.9, forms: ['Mount {}', '{} Mountains'] },
  person: { chance: 0.5, forms: ['{} {s}'] },
};

// ── Markov model ─────────────────────────────────────────────────────────────

type Rand = () => number;
const pick = <T>(a: readonly T[], rand: Rand): T => a[Math.floor(rand() * a.length)];

interface Model {
  order: number;
  /** tables[k]: context of k letters → next letter → count. */
  tables: Map<string, Map<string, number>>[];
  seen: Set<string>;
  minLen: number;
  maxLen: number;
}

const START = '^';
const END = '$';

function train(words: string[]): Model {
  const clean = words.map((x) => x.toLowerCase().replace(/[^a-z]/g, '')).filter((x) => x.length > 1);
  const avg = clean.reduce((a, x) => a + x.length, 0) / Math.max(1, clean.length);
  const order = avg >= 6 ? 3 : 2;
  const tables: Model['tables'] = [];
  for (let k = 0; k <= order; k++) tables.push(new Map());
  for (const word of clean) {
    const padded = START.repeat(order) + word + END;
    for (let i = order; i < padded.length; i++) {
      for (let k = 1; k <= order; k++) {
        const ctx = padded.slice(i - k, i);
        let row = tables[k].get(ctx);
        if (!row) tables[k].set(ctx, (row = new Map()));
        row.set(padded[i], (row.get(padded[i]) ?? 0) + 1);
      }
    }
  }
  const lens = clean.map((x) => x.length).sort((a, b) => a - b);
  const q = (p: number) => lens[Math.min(lens.length - 1, Math.floor(p * lens.length))] ?? 6;
  return {
    order,
    tables,
    seen: new Set(clean),
    minLen: Math.max(3, Math.min(q(0.1), 5)),
    maxLen: Math.min(14, Math.max(6, q(0.92) + 1)),
  };
}

const models = new Map<string, Model>();
function modelFor(key: string, words: string[]): Model {
  let m = models.get(key);
  if (!m) models.set(key, (m = train(words)));
  return m;
}

function sample(row: Map<string, number>, rand: Rand): string {
  let total = 0;
  for (const n of row.values()) total += n;
  let r = rand() * total;
  for (const [ch, n] of row) {
    r -= n;
    if (r < 0) return ch;
  }
  return END;
}

/** Awkward spellings no culture here would write. */
const AWKWARD = /(.)\1\1|(..)\2\2|[^aeiouy]{5}|[aeiou]{4}|^[^aeiouy]{4}|[^aeiouy]{3}$|^(.)\3/;

/** Accidental English rude words are never wanted on a map. */
const RUDE = /jizz|fuck|shit|cunt|nigg|fag|cock|dick|piss|slut|whore|rape|penis|anal|porn|tits|twat|wank|cum$/;

/** Two consonants opening a word read well only in a few pairings (Br, Sh, St, Mb, Nd, Tz…). */
function badStart(s: string): boolean {
  const m = /^([^aeiouy])([^aeiouy])/.exec(s);
  return !!m && !/[smn]/.test(m[1]) && !/[hlrwvjzy]/.test(m[2]);
}

/** One new word from the model, or null when it came out unusable. */
function word(m: Model, rand: Rand): string | null {
  let s = START.repeat(m.order);
  for (let guard = 0; guard < 30; guard++) {
    // Mostly the longest context, sometimes a shorter one for variety; back off when unseen.
    let k = rand() < 0.75 ? m.order : m.order - 1;
    let row: Map<string, number> | undefined;
    for (; k >= 1 && !row; k--) row = m.tables[k].get(s.slice(-k));
    if (!row) return null;
    const ch = sample(row, rand);
    if (ch === END) break;
    s += ch;
    if (s.length - m.order > m.maxLen) return null;
  }
  const out = s.slice(m.order).replace(/\^/g, '');
  if (out.length < m.minLen || out.length > m.maxLen) return null;
  if (m.seen.has(out) || AWKWARD.test(out) || RUDE.test(out) || badStart(out)) return null;
  return out;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Puts `value` into `form` at `slot`, gluing it to letters written right next to it. */
function fill(form: string, slot: string, value: string): string {
  const i = form.indexOf(slot);
  if (i < 0) return form;
  const before = form.slice(0, i);
  const after = form.slice(i + slot.length);
  let v = value;
  // "Jiang" + " Jiang" would say it twice.
  if (after.trim() && after.trim().toLowerCase() === v.toLowerCase()) return before + v;
  if (/[a-z]$/i.test(before)) v = v.toLowerCase();
  const suffix = /^[a-z]+/.exec(after)?.[0];
  if (suffix) {
    if (v.toLowerCase().endsWith(suffix)) return before + v + after.slice(suffix.length);
    if (/^[aeiouy]/.test(suffix)) {
      const cut = v.replace(/[aeiouy]+$/i, '');
      if (cut.length >= 3) v = cut;
    }
    // "Bergg" + "gard" reads badly: drop a doubled letter at the seam.
    if (v.slice(-1).toLowerCase() === suffix[0] && v.slice(-2, -1).toLowerCase() === suffix[0]) v = v.slice(0, -1);
  }
  return before + v + after;
}

/**
 * `count` unique names of a kind in a culture's style; deterministic for a seeded `rand`.
 * Unknown cultures fall back to Latin.
 */
export function generateNames(cultureId: string, kind: NameKind, count: number, rand: Rand = Math.random): string[] {
  const culture = cultureById(cultureId) ?? CULTURES[0];
  const places = modelFor(culture.id, culture.places);
  const people = kind === 'person' && culture.people ? modelFor(culture.id + ':people', culture.people) : places;
  const forms = culture.kinds?.[kind] ?? DEFAULT_FORMS[kind];
  const out = new Set<string>();
  const base = kind === 'person' ? people : places;

  for (let tries = 0; out.size < count && tries < count * 400; tries++) {
    const core = word(base, rand);
    if (!core) continue;
    let name = capital(core);
    if (forms.forms.length && rand() < forms.chance) {
      const form = pick(forms.forms, rand);
      if (form.includes('{s}')) {
        let sur: string | null = culture.surnames ? pick(culture.surnames, rand) : null;
        for (let i = 0; !sur && i < 20; i++) sur = word(places, rand);
        if (!sur) continue;
        name = fill(fill(form, '{s}', capital(sur)), '{}', name);
      } else name = fill(form, '{}', name);
    }
    // A form can turn a new name back into a real one ("Tehr" + "an").
    if (base.seen.has(name.toLowerCase().replace(/[^a-z]/g, '')) || places.seen.has(name.toLowerCase())) continue;
    out.add(name);
  }
  return [...out];
}

// ── Where on Earth ───────────────────────────────────────────────────────────

const inBox = (lng: number, lat: number, w: number, s: number, e: number, n: number) => lng >= w && lng <= e && lat >= s && lat <= n;

/** A rough default culture for a spot on Earth, used to preselect the generator. */
export function guessCulture(lng: number, lat: number): string {
  lng = ((((lng + 180) % 360) + 360) % 360) - 180;
  const at = (w: number, s: number, e: number, n: number) => inBox(lng, lat, w, s, e, n);

  if (lat < -60) return 'elvish';
  // Europe
  if (at(-25, 62.5, -12, 67.5) || at(-8, 61, -6, 63)) return 'norse';
  if (at(4.5, 54.5, 32, 72)) return 'norse';
  if (at(-11, 51.3, -5.5, 55.5) || at(-8, 55, -1.5, 61) || at(-5.5, 51.3, -3, 53.5)) return 'celtic';
  if (at(-6, 49.8, 2, 55)) return 'english';
  if (at(-5, 42.3, 7.5, 51.2)) return 'french';
  if (at(-10, 35.8, 3.5, 43.8)) return 'latin';
  if (at(6.5, 36, 19, 46.4)) return 'latin';
  if (at(19, 34, 29, 41.8) || at(32, 34.4, 34.8, 35.8)) return 'greek';
  if (at(5, 45.5, 17, 55.5)) return 'germanic';
  if (at(26, 35.8, 45, 42.2)) return 'turkic';
  if (at(13, 41, 60, 72)) return 'slavic';
  // Middle East, Central and South Asia
  if (at(44, 25, 63.5, 40) || at(60, 29, 75, 38.5)) return 'persian';
  if (at(46, 35, 90, 56) || at(87, 41, 120, 52)) return 'turkic';
  if (at(34, 12, 60, 37.5) || at(-17.5, 15, 35, 37.5)) return 'arabic';
  if (at(60, 5, 97, 35)) return 'indic';
  if (lat > 55 && lng > 60) return 'slavic';
  // East Asia and the Pacific
  if (at(129, 30, 146, 46)) return 'japanese';
  if (at(97, 18, 135, 54)) return 'chinese';
  if (at(92, -11, 141, 18)) return 'chinese';
  if (at(165, -48, 180, -34)) return 'polynesian';
  if (at(112, -44, 154, -10)) return 'english';
  if (lng > 141 || lng < -120) return lat > 50 ? 'english' : 'polynesian';
  // Africa
  if (at(-18, -35, 52, 15)) return 'bantu';
  // The Americas
  if (at(-118, 7, -77, 33)) return 'nahuatl';
  if (lng < -30 && lat >= 33) return 'english';
  if (lng < -30) return 'latin';
  return 'latin';
}
