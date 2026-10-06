import { Hero } from "@/components/landing/Hero";
import { DeparturesBoard } from "@/components/landing/DeparturesBoard";
import { FeatureSection } from "@/components/landing/FeatureSection";
import { RulesBento } from "@/components/landing/RulesBento";
import { AcrossBorders } from "@/components/landing/AcrossBorders";
import { StatsSection } from "@/components/landing/StatsSection";
import { Privacy } from "@/components/landing/Privacy";
import { Faq } from "@/components/landing/Faq";
import { FinalCta } from "@/components/landing/FinalCta";
import { getStats } from "@/lib/stats";

export const revalidate = 60;

export default async function Home() {
  const stats = await getStats();
  return (
    <div data-landing="">
      <Hero />
      <DeparturesBoard />
      <FeatureSection />
      <RulesBento />
      <AcrossBorders />
      <StatsSection stats={stats} />
      <Privacy />
      <Faq />
      <FinalCta />
    </div>
  );
}
