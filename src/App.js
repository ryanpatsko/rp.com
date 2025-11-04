import React, { useEffect, useState, useRef } from 'react';
import './App.css';
import devilDogProfile from './assets/devil-dog-profile.jpg';
import angelsLandingGlory from './assets/angels-landing-glory.jpg';
import bowieArch from './assets/bowie-arch.jpg';
import bowieCanyonlands from './assets/bowie-canyonlands.jpg';
import horseshoeBend from './assets/horseshoe-bend.jpg';
import monumentValleyVictory from './assets/monument-valley-victory.jpg';
import sanDiegoSlotCanyon from './assets/san-diego-slot-canyon.jpg';
import theWave from './assets/the-wave.jpg';
import thorsHammerFlex from './assets/thors-hammer-flex.jpg';
import tffLogo from './assets/TFF_Logo_Main_Banner.png';
import fantasylabsLogo from './assets/FantasyLabs_Logo_FullColor.svg';
import hallucinationBuckle from './assets/hallucination-100-buckle.jpg';
import devilDogBuckle from './assets/devil-dog-100-buckle.jpg';

function App() {
  const [scrollPosition, setScrollPosition] = useState(0);
  const [activeImage, setActiveImage] = useState(null);
  const galleryRef = useRef(null);
  
  useEffect(() => {
    const handleScroll = () => {
      setScrollPosition(window.scrollY);
    };
    
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div className="App">
      {/* Hero Section */}
      <section className="hero">
        <div className="hero-content">
          <div className="logo-container">
            <img src={devilDogProfile} alt="Ryan Patsko" className="profile-logo" />
          </div>
          <h1>Ryan Patsko</h1>
          <p className="tagline">Developer • Runner • Adventurer</p>
          
          <div className="social-links">
            <a href="https://github.com/ryanpatsko/" target="_blank" rel="noopener noreferrer" className="social-button github">
              <i className="fab fa-github"></i>
            </a>
            <a href="https://www.linkedin.com/in/ryan-patsko-44282450/" target="_blank" rel="noopener noreferrer" className="social-button linkedin">
              <i className="fab fa-linkedin"></i>
            </a>
            <a href="https://x.com/plako21" target="_blank" rel="noopener noreferrer" className="social-button twitter">
              <i className="fa-brands fa-x-twitter"></i>
            </a>
            <a href="https://t.co/JeqVTg9en8" target="_blank" rel="noopener noreferrer" className="social-button instagram">
              <i className="fab fa-instagram"></i>
            </a>
          </div>
        </div>
        <div className="scroll-indicator">
          <span>Scroll Down</span>
          <i className="fas fa-chevron-down"></i>
        </div>
      </section>

      {/* Full-width Parallax Image Section */}
      <section className="parallax-section" style={{ backgroundImage: `url(${angelsLandingGlory})` }}>
        <div className="parallax-content">
          <h2>
            <span className="gradient-letter">R</span>elentless{' '}
            <span className="forward-text">(forward)</span>{' '}
            <span className="gradient-letter">P</span>rogress
          </h2>
          <p>Pushing boundaries in technology, fitness, and adventure</p>
        </div>
      </section>

      {/* Work Life Section */}
      <section className="work-section">
        <h2>Work Life</h2>
        <div className="work-container">
          <div className="work-item">
            <div className="work-badge">Previously</div>
            <div className="work-logo">
              <img src={tffLogo} alt="The Fantasy Fanatics" className="work-logo-img" />
            </div>
            <h3>The Fantasy Fanatics</h3>
            <p>Founder / CEO</p>
            <p className="work-description">A ground-breaking daily fantasy sports site, acquired by FantasyLabs in 2017.</p>
          </div>
          
          <div className="work-item current">
            <div className="work-badge">Current</div>
            <div className="work-logo">
              <img src={fantasylabsLogo} alt="FantasyLabs" className="work-logo-img" />
            </div>
            <h3>FantasyLabs</h3>
            <p>Senior Software Engineer / Product Lead</p>
            <p className="work-description">Cutting edge tools and analysis for smart DFS players, now part of Better Collective.</p>
            <a href="https://fantasylabs.com" target="_blank" rel="noopener noreferrer" className="work-link">Visit FantasyLabs</a>
          </div>
          
          <div className="work-item">
            <div className="work-badge">Side Gigs</div>
            <div className="work-logo">
              <i className="fas fa-code-branch"></i>
            </div>
            <h3>Side Projects</h3>
            <p className="work-description">Building cool stuff on the side. Need a website or have an idea? Let's connect!</p>
            <div className="side-projects">
              <a href="https://eeeekcreative.com" target="_blank" rel="noopener noreferrer" className="project-link">Eeeek! Creative</a>
              <a href="#" className="project-link">North Parkley Marathons</a>
              <a href="https://wildchild-makeup.com/" target="_blank" rel="noopener noreferrer" className="project-link">Wild Child Fabrications</a>
            </div>
          </div>
        </div>
      </section>

      {/* Trail Life Section */}
      <section className="trail-section">
        <h2>Trail Life</h2>
        <div className="trail-container">
          <div className="trail-item">
            <div className="trail-badge">100 Miler</div>
            <div className="trail-logo">
              <img src={hallucinationBuckle} alt="Hallucination 100 Buckle" className="trail-logo-img" />
            </div>
            <h3>Hallucination 100</h3>
            <p>September 2023</p>
          </div>
          
          <div className="trail-item">
            <div className="trail-badge">100 Miler</div>
            <div className="trail-logo">
              <img src={devilDogBuckle} alt="Devil Dog 100 Buckle" className="trail-logo-img" />
            </div>
            <h3>Devil Dog 100</h3>
            <p>December 2024</p>
          </div>
          
          <div className="trail-item">
            <div className="trail-badge">Other Finishes</div>
            <div className="trail-logo">
              <i className="fas fa-medal"></i>
            </div>
            <h3>Ultra Portfolio</h3>
            <div className="finish-list">
              <ul>
                <li>Savage Camp 6x4x48</li>
                <li>4 50 Milers</li>
                <li>A dozen or so 50k's</li>
                <li>One 60k / aka 100M DNF</li>
              </ul>
              <a href="https://ultrasignup.com/m_results_participant.aspx?fname=Ryan&lname=Patsko" target="_blank" rel="noopener noreferrer" className="trail-link">Ultrasignup Profile</a>
            </div>
          </div>
        </div>
      </section>

      {/* Minimal Gallery Section */}
      <section className="minimal-gallery-section">
        <div className="gallery-scroll">
          <div className="gallery-track">
            <div className="gallery-slide">
              <img src={monumentValleyVictory} alt="Monument Valley" />
              <h3>Monument Valley</h3>
            </div>
            <div className="gallery-slide">
              <img src={bowieCanyonlands} alt="Canyonlands" />
              <h3>Canyonlands</h3>
            </div>
            <div className="gallery-slide">
              <img src={horseshoeBend} alt="Horseshoe Bend" />
              <h3>Horseshoe Bend</h3>
            </div>
            <div className="gallery-slide">
              <img src={sanDiegoSlotCanyon} alt="Torrey Pines" />
              <h3>Torrey Pines</h3>
            </div>
            <div className="gallery-slide">
              <img src={thorsHammerFlex} alt="Thor's Hammer" />
              <h3>Thor's Hammer</h3>
            </div>
          </div>
        </div>
      </section>

      {/* Quote Section with Background */}
      <section className="quote-section" style={{ backgroundImage: `url(${theWave})` }}>
        <div className="quote-overlay"></div>
        <div className="quote-content">
          <blockquote>
            "A road lies ahead, so tie up your shoes."
          </blockquote>
        </div>
      </section>

      {/* Footer */}
      <footer>
        <p>© {new Date().getFullYear()} Ryan Patsko. All rights reserved.</p>
      </footer>
    </div>
  );
}

export default App;
